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
  "ghk-cu-50":     { title: "GHK-Cu 50mg", price: 0 },
  "nad-buffered":  { title: "NAD+ Buffered", price: 0 },
  "bpc-tb500-10":  { title: "BPC-157/TB-500 10mg/10mg", price: 0 },
  "kisspeptin-10": { title: "Kisspeptin 10mg", price: 0 },
  "igf1-lr3-100":  { title: "IGF-1 LR3 100mg", price: 0 },
};

const SITE = "https://peptbiohacking.com";
const AIRTABLE_BASE = "appoSOvq7flVkIase";
const AIRTABLE_INVENTORY = "Shop%20Inventory";
const AIRTABLE_ORDERS = "Ordenes";

const CONSULT_PRICE = 1500;

async function fetchInventory(): Promise<Record<string, { stock: number; status: string; price: number }>> {
  const token = Deno.env.get("AIRTABLE_TOKEN");
  if (!token) return {};
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_INVENTORY}?pageSize=100`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return {};
  const data = await resp.json();
  const inv: Record<string, { stock: number; status: string; price: number }> = {};
  for (const rec of data.records || []) {
    const f = rec.fields || {};
    const sku = f.SKU;
    if (sku) {
      inv[sku] = {
        stock: Number(f.Stock) || 0,
        status: f.Status || "Out of Stock",
        price: Number(f["Price MXN"]) || 0,
      };
    }
  }
  return inv;
}

function effectivePrice(sku: string, airtablePrice: number): number {
  if (airtablePrice > 0) return airtablePrice;
  return CATALOG[sku]?.price || 0;
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
    const inventory = await fetchInventory();
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

    // Save to Airtable Ordenes
    const airtableToken = Deno.env.get("AIRTABLE_TOKEN");
    if (airtableToken) {
      const orderSummary = orderItems.map(i => `${i.title} x${i.qty} = $${(i.price * i.qty).toLocaleString()} MXN`).join(", ");
      const airtablePayload = {
        fields: {
          "Cliente": shipping.name,
          "Telefono": shipping.phone,
          "Email": shipping.email,
          "Direccion": shipping.address || "",
          "Estado": shipping.state || "",
          "Codigo Postal": shipping.zip || "",
          "Productos": orderSummary,
          "Total": finalTotal,
          "Upsell Consulta": upsellLabel,
          "Estatus": "Pagado",
          "Fecha": new Date().toISOString(),
        },
      };
      try {
        await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent("Ordenes")}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${airtableToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(airtablePayload),
        });
      } catch (_e) {
        console.warn("Airtable save failed, continuing to payment");
      }
    }

    // Create MP preference
    const mpItems = orderItems.map((i) => ({
      id: i.sku,
      title: i.title,
      quantity: i.qty,
      currency_id: "MXN",
      unit_price: i.price,
    }));

    // Add consult as a separate line item if selected
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
    const pref = {
      items: mpItems,
      back_urls: {
        success: `${SITE}/checkout.html?status=success`,
        pending: `${SITE}/checkout.html?status=pending`,
        failure: `${SITE}/checkout.html?status=failure`,
      },
      auto_return: "approved",
      statement_descriptor: "PEPTBIOHACKING",
      external_reference: `${skus}-${Date.now()}`,
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