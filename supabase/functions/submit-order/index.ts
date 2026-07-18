import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CATALOG: Record<string, { title: string; price: number }> = {
  "bpc-tb500": { title: "BPC-157 / TB-500", price: 3700 },
  "glp3-12": { title: "GLP-3 12mg", price: 3900 },
  "glp3-24": { title: "GLP-3 24mg", price: 5400 },
  "glp3-48": { title: "GLP-3 48mg", price: 7400 },
  "motsc-10": { title: "MOTS-C 10mg", price: 3900 },
  "tesa-ipa": { title: "Tesamorelin / Ipamorelin", price: 4400 },
  "dsip-10": { title: "DSIP 10mg", price: 3700 },
  "semax-10": { title: "Semax / Selank", price: 3700 },
  "glow-70": { title: "GLOW Protocol 70mg", price: 4900 },
  "bact-water-30": { title: "Agua Bacteriostatica 30ml", price: 900 },
  "bact-water-3": { title: "Agua Bacteriostatica 3ml", price: 300 },
  "cjc-1295": { title: "CJC-1295 / Ipamorelin", price: 3900 },
  "epitalon": { title: "Epitalon 10mg", price: 3400 },
  "pt141": { title: "PT-141 10mg", price: 3400 },
  "ghk-cu-50": { title: "GHK-Cu 50mg", price: 3400 },
  "ghk-cu-100": { title: "GHK-Cu 100mg", price: 3700 },
  "nad-buffered": { title: "NAD+ Buffered", price: 4100 },
  "bpc-tb500-10": { title: "BPC-157/TB-500 10mg/10mg", price: 4900 },
  "kisspeptin-10": { title: "Kisspeptin 10mg", price: 3400 },
  "igf1-lr3-100": { title: "IGF-1 LR3 100mg", price: 0 },
};

const SITE = "https://peptbiohacking.com";
const AIRTABLE_BASE = "appoSOvq7flVkIase";
const AIRTABLE_INVENTORY = "Shop Inventory";
const CONSULT_PRICE = 1500;
const ALLOWED_ORIGINS = new Set([SITE, "https://www.peptbiohacking.com"]);

type OrderItem = { sku: string; title: string; price: number; qty: number };
type Shipping = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || SITE;
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : SITE,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function clean(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function fetchInventory(): Promise<Record<string, { stock: number; status: string; price: number }>> {
  const token = Deno.env.get("AIRTABLE_TOKEN");
  if (!token) throw new Error("AIRTABLE_TOKEN is not configured");

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_INVENTORY)}?pageSize=100`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Airtable inventory failed: ${response.status}`);

  const data = await response.json();
  const inventory: Record<string, { stock: number; status: string; price: number }> = {};
  for (const record of data.records || []) {
    const fields = record.fields || {};
    if (fields.SKU) {
      inventory[fields.SKU] = {
        stock: Number(fields.Stock) || 0,
        status: fields.Status || "Out of Stock",
        price: Number(fields["Price MXN"]) || 0,
      };
    }
  }
  return inventory;
}

function effectivePrice(sku: string, airtablePrice: number): number {
  return airtablePrice > 0 ? airtablePrice : CATALOG[sku]?.price || 0;
}

function supabaseConfig(): { url: string; key: string } {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase service credentials are not configured");
  return { url, key };
}

async function createOrder(payload: Record<string, unknown>): Promise<{ public_id: string }> {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/orders?select=public_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const rows = await response.json();
  if (!response.ok || !rows?.[0]?.public_id) {
    console.error("Order insert failed", response.status, JSON.stringify(rows));
    throw new Error("No se pudo registrar el pedido");
  }
  return rows[0];
}

async function updateOrder(publicId: string, patch: Record<string, unknown>): Promise<void> {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/orders?public_id=eq.${encodeURIComponent(publicId)}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Order update failed: ${response.status}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Metodo no permitido" }, 405);

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { error: "Origen no permitido" }, 403);

  try {
    const accessToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!accessToken) throw new Error("MP_ACCESS_TOKEN is not configured");

    const body = await req.json();
    const entries = body.items;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 20) {
      return json(req, { error: "Carrito invalido" }, 400);
    }

    const shipping: Shipping = {
      name: clean(body.shipping?.name, 120),
      phone: clean(body.shipping?.phone, 40),
      email: clean(body.shipping?.email, 180).toLowerCase(),
      address: clean(body.shipping?.address, 240),
      city: clean(body.shipping?.city ?? body.shipping?.ciudad, 100),
      state: clean(body.shipping?.state, 100),
      zip: clean(body.shipping?.zip, 20),
    };
    if (!shipping.name || !shipping.phone || !validEmail(shipping.email) || !shipping.address || !shipping.city) {
      return json(req, { error: "Datos de envio incompletos" }, 400);
    }

    const inventory = await fetchInventory();
    const orderItems: OrderItem[] = [];
    for (const entry of entries) {
      const sku = clean(entry?.sku, 80);
      const catalogItem = CATALOG[sku];
      if (!catalogItem) return json(req, { error: `SKU desconocido: ${sku}` }, 400);

      const qty = Math.max(1, Math.min(10, Math.floor(Number(entry.quantity) || 1)));
      const available = inventory[sku];
      const price = effectivePrice(sku, available?.price || 0);
      if (price <= 0) return json(req, { error: `${catalogItem.title} no tiene precio asignado`, sku }, 400);
      if (!available || available.status === "Out of Stock" || available.status === "Discontinued") {
        return json(req, { error: `${catalogItem.title} esta agotado`, sku, stock: 0 }, 409);
      }
      if (available.stock < qty) {
        return json(req, { error: `Solo tenemos ${available.stock} de ${catalogItem.title}`, sku, stock: available.stock }, 409);
      }
      orderItems.push({ sku, title: catalogItem.title, price, qty });
    }

    const upsell = body.upsell === true;
    const itemsTotal = orderItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const finalTotal = itemsTotal + (upsell ? CONSULT_PRICE : 0);

    const order = await createOrder({
      customer_name: shipping.name,
      phone: shipping.phone,
      email: shipping.email,
      address: shipping.address,
      city: shipping.city,
      state: shipping.state,
      zip: shipping.zip,
      products: orderItems,
      total: finalTotal,
      upsell,
      status: "creating_payment",
    });

    const mpItems: Array<Record<string, unknown>> = orderItems.map((item) => ({
      id: item.sku,
      title: item.title,
      quantity: item.qty,
      currency_id: "MXN",
      unit_price: item.price,
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

    const returnQuery = `order=${encodeURIComponent(order.public_id)}`;
    const preference = {
      items: mpItems,
      payer: { name: shipping.name, email: shipping.email },
      back_urls: {
        success: `${SITE}/checkout.html?status=success&${returnQuery}`,
        pending: `${SITE}/checkout.html?status=pending&${returnQuery}`,
        failure: `${SITE}/checkout.html?status=failure&${returnQuery}`,
      },
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
      auto_return: "approved",
      statement_descriptor: "PEPTBIOHACKING",
      external_reference: order.public_id,
    };

    const mpResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `preference-${order.public_id}`,
      },
      body: JSON.stringify(preference),
    });
    const mpData = await mpResponse.json();
    if (!mpResponse.ok || !mpData.id || !mpData.init_point) {
      console.error("Mercado Pago preference failed", mpResponse.status, JSON.stringify(mpData));
      await updateOrder(order.public_id, { status: "payment_setup_failed" });
      return json(req, { error: "No se pudo iniciar Mercado Pago" }, 502);
    }

    await updateOrder(order.public_id, {
      mp_preference_id: mpData.id,
      status: "pending_payment",
    });

    return json(req, { init_point: mpData.init_point, order_id: order.public_id });
  } catch (error) {
    console.error("submit-order error", error);
    return json(req, { error: "No se pudo procesar el pedido. Intenta de nuevo." }, 500);
  }
});
