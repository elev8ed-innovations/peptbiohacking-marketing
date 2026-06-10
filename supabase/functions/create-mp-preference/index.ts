import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Server-side catalog — single source of truth for prices (MXN)
const CATALOG: Record<string, { title: string; price: number }> = {
  "bpc-tb500":     { title: "BPC-157 / TB-500", price: 4500 },
  "glp3-12":       { title: "GLP-3 12mg", price: 4900 },
  "glp3-24":       { title: "GLP-3 24mg", price: 9800 },
  "glp3-48":       { title: "GLP-3 48mg", price: 0 },          /* FILL LATER — Dr V */
  "motsc-10":      { title: "MOTS-C 10mg", price: 4500 },
  "tesa-ipa":      { title: "Tesamorelin / Ipamorelin", price: 5900 },
  "dsip-10":       { title: "DSIP 5mg", price: 2500 },
  "semax-10":      { title: "Semax / Selank", price: 2900 },
  "glow-70":       { title: "GLOW Protocol 70mg", price: 5900 },
  "bact-water-30": { title: "Agua Bacteriostática 30ml", price: 400 },
  "bact-water-3":  { title: "Agua Bacteriostática 3ml", price: 0 }, /* FILL LATER — Dr V */
  "cjc-1295":      { title: "CJC-1295 / Ipamorelin", price: 4500 },
  "epitalon":      { title: "Epitalon 10mg", price: 4000 },
  "pt141":         { title: "PT-141 10mg", price: 2900 },
};

const SITE = "https://peptbiohacking.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { sku, quantity = 1 } = await req.json();
    const item = CATALOG[sku];
    if (!item) {
      return new Response(JSON.stringify({ error: "SKU desconocido" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (item.price === 0) {
      return new Response(JSON.stringify({ error: "Producto no disponible por el momento" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const qty = Math.max(1, Math.min(10, Number(quantity) || 1));

    const pref = {
      items: [{
        id: sku,
        title: item.title,
        quantity: qty,
        currency_id: "MXN",
        unit_price: item.price,
      }],
      back_urls: {
        success: `${SITE}/shop.html?status=success`,
        pending: `${SITE}/shop.html?status=pending`,
        failure: `${SITE}/shop.html?status=failure`,
      },
      auto_return: "approved",
      statement_descriptor: "PEPTBIOHACKING",
      external_reference: `${sku}-${Date.now()}`,
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
