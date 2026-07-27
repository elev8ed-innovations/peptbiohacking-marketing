import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Fallback catalog for products with known prices.
// Airtable prices override these when > 0 (so when Dr. V sets a price, it auto-works).
const CATALOG: Record<string, { title: string; price: number }> = {
  // Original 14 products
  "bpc-tb500":     { title: "BPC-157 / TB-500", price: 3700 },
  "glp3-12":       { title: "GLP-3 12mg", price: 3900 },
  "glp3-24":       { title: "GLP-3 24mg", price: 5400 },
  "glp3-48":       { title: "GLP-3 48mg", price: 7400 },
  "motsc-10":      { title: "MOTS-C 10mg", price: 3900 },
  "tesa-ipa":      { title: "Tesamorelin / Ipamorelin", price: 4400 },
  "dsip-10":       { title: "DSIP 10mg", price: 3700 },
  "semax-10":      { title: "Semax / Selank", price: 3700 },
  "glow-70":       { title: "GLOW Protocol 70mg", price: 4900 },
  "bact-water-30": { title: "Agua Bacteriostática 30ml", price: 900 },
  "bact-water-3":  { title: "Agua Bacteriostática 3ml", price: 300 },
  "cjc-1295":      { title: "CJC-1295 / Ipamorelin", price: 3900 },
  "epitalon":      { title: "Epitalon 10mg", price: 3400 },
  "pt141":         { title: "PT-141 10mg", price: 3400 },
  // New products (prices pending from Dr. V — set to 0, will use Airtable when available)
  "ghk-cu-50":     { title: "GHK-Cu 50mg", price: 0 },
  "nad-buffered":  { title: "NAD+ Buffered", price: 0 },
  "bpc-tb500-10":  { title: "BPC-157/TB-500 10mg/10mg", price: 0 },
  "kisspeptin-10": { title: "Kisspeptin 10mg", price: 0 },
  "igf1-lr3-100":  { title: "IGF-1 LR3 100mg", price: 0 },
};

const SITE = "https://peptbiohacking.com";
const AIRTABLE_BASE = "appKo9tyGtIju3UHN";
const AIRTABLE_TABLE = "Inventario";

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

/** Fetch live stock AND prices from Airtable — returns { sku -> { stock, status, price } } */
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

/** Resolve effective price: Airtable price > 0 wins, otherwise fallback to CATALOG */
function effectivePrice(sku: string, airtablePrice: number): number {
  if (airtablePrice > 0) return airtablePrice;
  const fallback = CATALOG[sku];
  return fallback ? fallback.price : 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    let items: Array<{ sku: string; title: string; price: number; qty: number }> = [];

    if (body.items && Array.isArray(body.items)) {
      for (const entry of body.items) {
        const sku = entry.sku;
        const cat = CATALOG[sku];
        if (!cat) {
          return new Response(JSON.stringify({ error: `SKU desconocido: ${sku}` }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const qty = Math.max(1, Math.min(10, Number(entry.quantity) || 1));
        items.push({ sku, title: cat.title, price: cat.price, qty });
      }
    } else if (body.sku) {
      const cat = CATALOG[body.sku];
      if (!cat) {
        return new Response(JSON.stringify({ error: "SKU desconocido" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      const qty = Math.max(1, Math.min(10, Number(body.quantity) || 1));
      items.push({ sku: body.sku, title: cat.title, price: cat.price, qty });
    } else {
      return new Response(JSON.stringify({ error: "Formato inválido" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch live data from Airtable (stock + prices)
    let inventory: Record<string, { stock: number; status: string; price: number }>;
    try {
      inventory = await fetchInventory();
    } catch (e) {
      console.error("Inventory unavailable:", e);
      return new Response(JSON.stringify({ error: "Inventario temporalmente no disponible. Intenta de nuevo." }), {
        status: 503, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // 3. Override prices from Airtable and check stock
    for (const item of items) {
      const inv = inventory[item.sku];
      const airPrice = inv ? inv.price : 0;
      item.price = effectivePrice(item.sku, airPrice);

      if (item.price === 0) {
        return new Response(JSON.stringify({
          error: `${item.title} no tiene precio asignado. Consulta a Dr. Valenzuela para actualizarlo.`,
          sku: item.sku,
        }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      if (!inv) {
        return new Response(JSON.stringify({
          error: `${item.title} no está vinculado al inventario. Consulta a Dr. Valenzuela.`,
          sku: item.sku,
        }), {
          status: 409, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      if (inv) {
        if (inv.status === "Out of Stock" || inv.status === "Discontinued") {
          return new Response(JSON.stringify({
            error: `${item.title} está agotado. Por favor elimínalo de tu carrito.`,
            sku: item.sku,
            stock: 0,
          }), {
            status: 409, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        if (inv.stock < item.qty) {
          return new Response(JSON.stringify({
            error: `Solo tenemos ${inv.stock} unidades de ${item.title}. Reduce la cantidad o elimínalo.`,
            sku: item.sku,
            stock: inv.stock,
          }), {
            status: 409, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        if (inv.status === "Low Stock") {
          console.log(`⚠️ Low stock: ${item.sku} (${inv.stock} left) — allowing checkout`);
        }
      }
    }

    // 4. Create MP preference
    const mpItems = items.map((i) => ({
      id: i.sku,
      title: i.title,
      quantity: i.qty,
      currency_id: "MXN",
      unit_price: i.price,
    }));

    const skus = items.map((i) => i.sku).join("-");
    const pref = {
      items: mpItems,
      back_urls: {
        success: `${SITE}/shop.html?status=success`,
        pending: `${SITE}/shop.html?status=pending`,
        failure: `${SITE}/shop.html?status=failure`,
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
    return new Response(JSON.stringify({ error: "Solicitud inválida" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
