import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CLINIC_EMAIL = "arianarecreo@gmail.com";
const FROM_EMAIL = "pedidos@peptbiohacking.com";
const CONSULT_PRICE = 1500;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${await response.text()}`);
}

async function claimNotification(
  supabaseUrl: string,
  serviceKey: string,
  orderId: number,
  kind: "clinic" | "customer",
): Promise<boolean> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_order_notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ p_order_id: orderId, p_kind: kind }),
  });
  if (!response.ok) throw new Error(`Notification claim failed: ${await response.text()}`);
  return Boolean(await response.json());
}

async function markNotification(
  supabaseUrl: string,
  serviceKey: string,
  orderId: number,
  kind: "clinic" | "customer",
  status: "sent" | "error",
  error?: string,
): Promise<void> {
  const payload = kind === "clinic"
    ? { clinic_email_status: status, clinic_email_sent_at: status === "sent" ? new Date().toISOString() : null, notification_error: error || null }
    : { customer_email_status: status, customer_email_sent_at: status === "sent" ? new Date().toISOString() : null, notification_error: error || null };
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${orderId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Notification status update failed: ${await response.text()}`);
}

async function sendApprovedNotifications(
  supabaseUrl: string,
  serviceKey: string,
  order: any,
): Promise<void> {
  const products = Array.isArray(order.products) ? order.products : [];
  const summary = products.map((item: any) =>
    `• ${escapeHtml(item.title)} x${Number(item.qty) || 1} = $${((Number(item.price) || 0) * (Number(item.qty) || 1)).toLocaleString()} MXN`
  ).join("<br>");
  const itemsTotal = products.reduce((sum: number, item: any) =>
    sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);

  const clinicHtml = `
<h2>✅ Pedido pagado — PeptBiohacking</h2>
<table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
<tr><td style="padding:10px;font-weight:600;">Cliente</td><td>${escapeHtml(order.customer_name)}</td></tr>
<tr><td style="padding:10px;font-weight:600;">Teléfono</td><td>${escapeHtml(order.phone)}</td></tr>
<tr><td style="padding:10px;font-weight:600;">Email</td><td>${escapeHtml(order.email)}</td></tr>
<tr><td style="padding:10px;font-weight:600;">Dirección</td><td>${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.zip)}</td></tr>
</table>
<h3>Productos</h3><p>${summary}</p>
<p><strong>Subtotal:</strong> $${itemsTotal.toLocaleString()} MXN<br>
${order.upsell ? `<strong>Consulta Dr. V:</strong> +$${CONSULT_PRICE.toLocaleString()} MXN<br>` : ""}
<strong>Total pagado:</strong> $${Number(order.total).toLocaleString()} MXN</p>
<p><strong>Pago Mercado Pago:</strong> ${escapeHtml(order.mp_payment_id)}</p>`;

  const customerHtml = `
<h2>✅ Pago confirmado, ${escapeHtml(String(order.customer_name || "").split(" ")[0])}.</h2>
<p>Recibimos tu pago correctamente. El <strong>Dr. Fernando Valenzuela</strong> revisará tu pedido y te contactará para coordinar el envío.</p>
<h3>Resumen</h3><p>${summary}</p>
<p><strong>Total pagado:</strong> $${Number(order.total).toLocaleString()} MXN</p>
<p>¿Tienes dudas? Escríbenos por WhatsApp al <strong>+52 662 424 2441</strong>.</p>`;

  for (const notification of [
    { kind: "clinic" as const, to: CLINIC_EMAIL, subject: `✅ Pedido pagado — ${order.customer_name}`, html: clinicHtml },
    { kind: "customer" as const, to: order.email, subject: "✅ Pago confirmado — PeptBiohacking", html: customerHtml },
  ]) {
    if (!await claimNotification(supabaseUrl, serviceKey, order.id, notification.kind)) continue;
    try {
      await sendEmail(notification.to, notification.subject, notification.html);
      await markNotification(supabaseUrl, serviceKey, order.id, notification.kind, "sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markNotification(supabaseUrl, serviceKey, order.id, notification.kind, "error", message.slice(0, 1000));
      throw error;
    }
  }
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const eventType = body?.type
      || body?.topic
      || url.searchParams.get("type")
      || url.searchParams.get("topic");
    if (eventType && eventType !== "payment") {
      return new Response("ignored", { status: 200 });
    }

    const paymentId = String(body?.data?.id || url.searchParams.get("data.id") || "");
    if (!paymentId) return new Response("ignored", { status: 200 });

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN") || "";
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });
    if (!paymentResponse.ok) {
      console.error("Mercado Pago payment verification failed:", paymentResponse.status);
      return new Response("verification failed", { status: 502 });
    }

    const payment = await paymentResponse.json();
    const externalReference = String(payment.external_reference || "");
    if (!externalReference) return new Response("ignored", { status: 200 });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const orderResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?select=*&external_reference=eq.${encodeURIComponent(externalReference)}&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!orderResponse.ok) {
      throw new Error(`Order lookup failed: ${await orderResponse.text()}`);
    }
    const orders = await orderResponse.json();
    const order = orders?.[0];
    if (!order) return new Response("order not found", { status: 200 });

    if (payment.status === "approved") {
      const inventoryResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/apply_paid_order_inventory`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ p_order_id: order.id, p_payment_id: paymentId }),
      });
      if (!inventoryResponse.ok) {
        console.error("Inventory application failed:", await inventoryResponse.text());
        return new Response("inventory failed", { status: 500 });
      }
      order.status = "approved";
      order.mp_payment_id = paymentId;
      await sendApprovedNotifications(supabaseUrl, serviceKey, order);
    } else {
      await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ status: payment.status, mp_payment_id: paymentId }),
      });
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("Webhook handler failed:", error);
    return new Response("error", { status: 500 });
  }
});
