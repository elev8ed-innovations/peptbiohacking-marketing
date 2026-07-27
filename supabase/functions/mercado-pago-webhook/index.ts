import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
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
      `${supabaseUrl}/rest/v1/orders?select=id,status&external_reference=eq.${encodeURIComponent(externalReference)}&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
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
