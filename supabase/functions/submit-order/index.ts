import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATALOG: Record<string, { title: string; price: number }> = {
  "bpc-tb500":     { title: "BPC-157 / TB-500", price: 3700 },
  "glp3-12":       { title: "GLP-3 12mg", price: 3900 },
  "glp3-24":       { title: "GLP-3 24mg", price: 5400 },
  "glp3-48":       { title: "GLP-3 48mg", price: 7400 },
  "motsc-10":      { title: "MOTS-C 10mg", price: 3900 },
  "tesa-ipa":      { title: "Tesamorelin / Ipamorelin", price: 4400 },
  "dsip-10":       { title: "DSIP 10mg", price: 3700 },
  "semax-10":      { title: "Semax / Selank", price: 3700 },
  "glow-70":       { title: "GLOW Protocol 70mg", price: 4900 },
  "bact-water-30": { title: "Agua Bacteriostatica 30ml", price: 900 },
  "bact-water-3":  { title: "Agua Bacteriostatica 3ml", price: 300 },
  "cjc-1295":      { title: "CJC-1295 / Ipamorelin", price: 3900 },
  "epitalon":      { title: "Epitalon 10mg", price: 3400 },
  "pt141":         { title: "PT-141 10mg", price: 3400 },
  "ghk-cu-50":     { title: "GHK-Cu 50mg", price: 3400 },
  "ghk-cu-100":    { title: "GHK-Cu 100mg", price: 3700 },
  "nad-buffered":  { title: "NAD+ Buffered", price: 4100 },
  "bpc-tb500-10":  { title: "BPC-157/TB-500 10mg/10mg", price: 4900 },
  "kisspeptin-10": { title: "Kisspeptin 10mg", price: 3400 },
  "igf1-lr3-100":  { title: "IGF-1 LR3 100mg", price: 0 },
};

const SITE = "https://peptbiohacking.com";
const AIRTABLE_BASE = "appKo9tyGtIju3UHN";
const AIRTABLE_INVENTORY = "Inventario";
const AIRTABLE_ORDERS = "Ordenes";

const CONSULT_PRICE = 1500;

const NOTIFY_EMAIL = "arianarecreo@gmail.com";
const FROM_EMAIL = "pedidos@peptbiohacking.com";

const SKU_BY_PRODUCT: Record<string, string> = {
  "glp312mg": "glp3-12", "glp324mg": "glp3-24", "glp348mg": "glp3-48",
  "bpc157tb5005mg5mg": "bpc-tb500", "bpc157tb50010mg10mg": "bpc-tb500-10",
  "cjc1295ipamorelin5mg5mg": "cjc-1295", "tesamorelinipamorelin": "tesa-ipa",
  "motsc10mg": "motsc-10", "dsip10mg": "dsip-10", "semaxselank": "semax-10",
  "glowbpc157tb500ghkcu": "glow-70", "epitalon10mg": "epitalon",
  "pt14110mg": "pt141", "ghkcu50mg": "ghk-cu-50", "ghkcu100mg": "ghk-cu-100",
  "nadbuffered": "nad-buffered", "kisspeptin10mg": "kisspeptin-10",
  "aguabacteriostatica30ml": "bact-water-30", "aguabacteriostatica3ml": "bact-water-3",
};

function normalize(value: unknown): string {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function canonicalStatus(value: unknown, stock: number): string {
  const status = normalize(value);
  if (status.includes("descontinu") || status.includes("discontinu")) return "Discontinued";
  if (stock <= 0 || status.includes("agotado") || status.includes("outofstock")) return "Out of Stock";
  if (status.includes("bajo") || status.includes("lowstock") || stock <= 5) return "Low Stock";
  return "In Stock";
}

async function fetchInventory(): Promise<Record<string, { stock: number; status: string; price: number }>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials unavailable");
  const resp = await fetch(`${supabaseUrl}/rest/v1/products?select=sku,stock_on_hand,active,price_mxn`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Supabase inventory fetch failed: ${resp.status} ${detail}`);
  }
  const data = await resp.json();
  const inv: Record<string, { stock: number; status: string; price: number }> = {};
  for (const product of data || []) {
    const stock = Number(product.stock_on_hand) || 0;
    inv[product.sku] = {
      stock,
      status: !product.active ? "Discontinued" : stock <= 0 ? "Out of Stock" : stock <= 5 ? "Low Stock" : "In Stock",
      price: Number(product.price_mxn) || 0,
    };
  }
  return inv;
}

function effectivePrice(sku: string, airtablePrice: number): number {
  if (airtablePrice > 0) return airtablePrice;
  return CATALOG[sku]?.price || 0;
}

function orderSummary(orderItems: Array<{ title: string; price: number; qty: number }>): string {
  return orderItems.map(i => `  • ${i.title} x${i.qty} = $${(i.price * i.qty).toLocaleString()} MXN`).join("\n");
}

async function sendEmail(params: { to: string; subject: string; html: string }): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set, skipping email");
    return;
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.warn("Resend error:", err);
    } else {
      console.log(`Email sent to ${params.to}`);
    }
  } catch (e) {
    console.warn("Email send failed:", e);
  }
}

async function sendNotifications(
  orderItems: Array<{ sku: string; title: string; price: number; qty: number }>,
  shipping: { name: string; phone: string; email: string; address: string; city: string; state: string; zip: string },
  finalTotal: number,
  upsell: boolean,
): Promise<void> {
  const summary = orderSummary(orderItems);
  const itemsTotal = orderItems.reduce((s, i) => s + i.price * i.qty, 0);

  // 1. Notify Dr. V / clinic
  const drHtml = `
<h2>🛒 Nuevo Pedido — PeptBiohacking</h2>
<table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
<tr style="background:#f5f4f0;"><td style="padding:10px;font-weight:600;width:120px;">Cliente</td><td style="padding:10px;">${shipping.name}</td></tr>
<tr><td style="padding:10px;font-weight:600;">Teléfono</td><td style="padding:10px;">${shipping.phone}</td></tr>
<tr style="background:#f5f4f0;"><td style="padding:10px;font-weight:600;">Email</td><td style="padding:10px;">${shipping.email}</td></tr>
<tr><td style="padding:10px;font-weight:600;">Dirección</td><td style="padding:10px;">${shipping.address}, ${shipping.city}, ${shipping.state} ${shipping.zip}</td></tr>
</table>
<h3>Productos</h3>
<pre style="font-family:monospace;background:#f9f9f9;padding:12px;border-radius:6px;">${summary}</pre>
<p><strong>Subtotal:</strong> $${itemsTotal.toLocaleString()} MXN<br>
${upsell ? `<strong>Consulta Dr. V:</strong> +$${CONSULT_PRICE.toLocaleString()} MXN<br>` : ""}
<strong>Total:</strong> <span style="font-size:18px;color:#2A7C6F;">$${finalTotal.toLocaleString()} MXN</span></p>
<hr>
<p style="color:#888;font-size:12px;">Revisa el pedido y confirma disponibilidad con el cliente.</p>`;

  // 2. Customer confirmation
  const customerHtml = `
<h2>✅ Gracias por tu pedido, ${shipping.name.split(" ")[0]}.</h2>
<p>Hemos recibido tu pedido correctamente. El <strong>Dr. Fernando Valenzuela</strong> revisará tu perfil y te confirmará los detalles en las próximas horas.</p>
<h3>Resumen</h3>
<pre style="font-family:monospace;background:#f9f9f9;padding:12px;border-radius:6px;">${summary}</pre>
<p><strong>Total:</strong> $${finalTotal.toLocaleString()} MXN</p>
<hr>
<p style="color:#888;font-size:13px;">¿Tienes dudas? Escríbenos por WhatsApp al <strong>+52 662 424 2441</strong> o responde a este correo.</p>`;

  await Promise.all([
    sendEmail({ to: NOTIFY_EMAIL, subject: `🛒 Nuevo Pedido — ${shipping.name}`, html: drHtml }),
    sendEmail({ to: shipping.email, subject: "✅ Recibimos tu pedido — PeptBiohacking", html: customerHtml }),
  ]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const { items, shipping, upsell } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: "Carrito vacio" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (!shipping || !shipping.name || !shipping.email || !shipping.phone) {
      return new Response(JSON.stringify({ error: "Datos de envio incompletos" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Validate items
    const orderItems: Array<{ sku: string; title: string; price: number; qty: number }> = [];
    for (const entry of items) {
      const sku = entry.sku;
      const cat = CATALOG[sku];
      if (!cat) {
        return new Response(JSON.stringify({ error: `SKU desconocido: ${sku}` }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      const qty = Math.max(1, Math.min(10, Number(entry.quantity) || 1));
      orderItems.push({ sku, title: cat.title, price: cat.price, qty });
    }

    // Fetch Airtable for stock + prices
    let inventory: Record<string, { stock: number; status: string; price: number }>;
    try {
      inventory = await fetchInventory();
    } catch (e) {
      console.error("Inventory unavailable:", e);
      return new Response(JSON.stringify({ error: "Inventario temporalmente no disponible. Intenta de nuevo." }), {
        status: 503, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    for (const item of orderItems) {
      const inv = inventory[item.sku];
      const airPrice = inv ? inv.price : 0;
      item.price = effectivePrice(item.sku, airPrice);

      if (item.price === 0) {
        return new Response(JSON.stringify({
          error: `${item.title} no tiene precio asignado. Consulta a Dr. Valenzuela.`,
          sku: item.sku,
        }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
      }

      if (!inv) {
        return new Response(JSON.stringify({
          error: `${item.title} no está vinculado al inventario.`,
          sku: item.sku,
        }), { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
      }
      if (inv) {
        if (inv.status === "Out of Stock" || inv.status === "Discontinued") {
          return new Response(JSON.stringify({
            error: `${item.title} esta agotado.`,
            sku: item.sku, stock: 0,
          }), { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
        }
        if (inv.stock < item.qty) {
          return new Response(JSON.stringify({
            error: `Solo tenemos ${inv.stock} de ${item.title}.`,
            sku: item.sku, stock: inv.stock,
          }), { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
        }
      }
    }

    // Build totals
    const itemsTotal = orderItems.reduce((s, i) => s + i.price * i.qty, 0);
    const finalTotal = itemsTotal + (upsell ? CONSULT_PRICE : 0);
    const upsellLabel = upsell ? "Si - Consulta 30min Dr.V" : "No";

    // Create MP preference
    const mpItems = orderItems.map((i) => ({
      id: i.sku,
      title: i.title,
      quantity: i.qty,
      currency_id: "MXN",
      unit_price: i.price,
    }));

    if (upsell) {
      mpItems.push({
        id: "consulta-drv",
        title: "Consulta 30 min Dr. Valenzuela",
        quantity: 1,
        currency_id: "MXN",
        unit_price: CONSULT_PRICE,
      });
    }

    const skus = orderItems.map((i) => i.sku).join("-");
    const orderReference = `${skus}-${crypto.randomUUID()}`;
    const pref = {
      items: mpItems,
      back_urls: {
        success: `${SITE}/checkout.html?status=success`,
        pending: `${SITE}/checkout.html?status=pending`,
        failure: `${SITE}/checkout.html?status=failure`,
      },
      auto_return: "approved",
      statement_descriptor: "PEPTBIOHACKING",
      external_reference: orderReference,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mercado-pago-webhook`,
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pref),
    });

    const data = await mpRes.json();
    if (!mpRes.ok) {
      console.error("MP error:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: data.message || "Error creando preferencia" }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Save order to Supabase (we own this data)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (supabaseUrl && supabaseKey) {
        const orderPayload = {
          customer_name: shipping.name,
          phone: shipping.phone,
          email: shipping.email,
          address: shipping.address || "",
          city: shipping.city || "",
          state: shipping.state || "",
          zip: shipping.zip || "",
          products: orderItems.map(i => ({ sku: i.sku, title: i.title, price: i.price, qty: i.qty })),
          total: finalTotal,
          upsell: upsell ?? false,
          mp_preference_id: data.id || "",
          external_reference: orderReference,
          status: "pending",
        };
        const saveResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify(orderPayload),
        });
        if (!saveResponse.ok) {
          throw new Error(`Order save failed: ${saveResponse.status} ${await saveResponse.text()}`);
        }
      }
    } catch (e) {
      console.error("Supabase save failed:", e);
      return new Response(JSON.stringify({ error: "No se pudo guardar el pedido. No se realizó ningún cargo." }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Send notification emails (fire-and-forget)
    sendNotifications(orderItems, shipping, finalTotal, upsell ?? false);

    return new Response(JSON.stringify({ init_point: data.init_point }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Handler error:", e);
    return new Response(JSON.stringify({ error: "Solicitud invalida" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
