const CONSULT_PRICE = 1500;
const NOTIFY_EMAIL = "arianarecreo@gmail.com";
const FROM_EMAIL = "pedidos@peptbiohacking.com";

export type OrderItem = {
  sku: string;
  title: string;
  price: number;
  qty: number;
};

export type PaidOrder = {
  public_id: string;
  customer_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  products: OrderItem[];
  total: number;
  upsell: boolean;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number): string {
  return Number(value || 0).toLocaleString("es-MX");
}

function itemSummary(items: OrderItem[]): string {
  return items
    .map((item) =>
      `  • ${escapeHtml(item.title)} x${item.qty} = $${money(item.price * item.qty)} MXN`
    )
    .join("\n");
}

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("RESEND_API_KEY is not configured");
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!response.ok) {
    console.error("Resend error", response.status, await response.text());
    return false;
  }
  return true;
}

export async function sendPaidOrderNotifications(order: PaidOrder): Promise<boolean> {
  const products = Array.isArray(order.products) ? order.products : [];
  const summary = itemSummary(products);
  const itemsTotal = products.reduce((sum, item) => sum + item.price * item.qty, 0);
  const firstName = escapeHtml(order.customer_name.trim().split(/\s+/)[0] || "cliente");

  const clinicHtml = `
<h2>✅ Pago acreditado — PeptBiohacking</h2>
<table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
<tr style="background:#f5f4f0;"><td style="padding:10px;font-weight:600;width:120px;">Cliente</td><td style="padding:10px;">${escapeHtml(order.customer_name)}</td></tr>
<tr><td style="padding:10px;font-weight:600;">Teléfono</td><td style="padding:10px;">${escapeHtml(order.phone)}</td></tr>
<tr style="background:#f5f4f0;"><td style="padding:10px;font-weight:600;">Email</td><td style="padding:10px;">${escapeHtml(order.email)}</td></tr>
<tr><td style="padding:10px;font-weight:600;">Dirección</td><td style="padding:10px;">${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.zip)}</td></tr>
</table>
<h3>Productos</h3>
<pre style="font-family:monospace;background:#f9f9f9;padding:12px;border-radius:6px;">${summary}</pre>
<p><strong>Subtotal:</strong> $${money(itemsTotal)} MXN<br>
${order.upsell ? `<strong>Consulta Dr. V:</strong> +$${money(CONSULT_PRICE)} MXN<br>` : ""}
<strong>Total pagado:</strong> <span style="font-size:18px;color:#2A7C6F;">$${money(order.total)} MXN</span></p>
<p style="color:#888;font-size:12px;">Pedido ${escapeHtml(order.public_id)}. El pago fue verificado directamente con Mercado Pago.</p>`;

  const customerHtml = `
<h2>✅ Pago confirmado, ${firstName}.</h2>
<p>Tu pago fue acreditado y recibimos tu pedido correctamente. El <strong>Dr. Fernando Valenzuela</strong> revisará tu perfil y te confirmará los detalles.</p>
<h3>Resumen</h3>
<pre style="font-family:monospace;background:#f9f9f9;padding:12px;border-radius:6px;">${summary}</pre>
<p><strong>Total pagado:</strong> $${money(order.total)} MXN</p>
<hr>
<p style="color:#888;font-size:13px;">¿Tienes dudas? Escríbenos por WhatsApp al <strong>+52 662 424 2441</strong> o responde a este correo.</p>`;

  const results = await Promise.all([
    sendEmail({
      to: NOTIFY_EMAIL,
      subject: `✅ Pago acreditado — ${order.customer_name}`,
      html: clinicHtml,
      idempotencyKey: `paid-clinic-${order.public_id}`,
    }),
    sendEmail({
      to: order.email,
      subject: "✅ Pago confirmado — PeptBiohacking",
      html: customerHtml,
      idempotencyKey: `paid-customer-${order.public_id}`,
    }),
  ]);

  return results.every(Boolean);
}
