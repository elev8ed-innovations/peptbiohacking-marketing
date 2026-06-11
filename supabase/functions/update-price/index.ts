import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "appoSOvq7flVkIase";
const TABLE = "Shop%20Inventory";
const SITE = "https://peptbiohacking.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { sku, price, passcode } = await req.json();
    
    // Simple passcode check
    if (passcode !== "PEPBIO2026") {
      return new Response(JSON.stringify({ error: "Código incorrecto" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!sku || price === undefined || price === null) {
      return new Response(JSON.stringify({ error: "Faltan SKU o precio" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const token = Deno.env.get("AIRTABLE_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "Server config error" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Find the record by SKU
    const findUrl = `https://api.airtable.com/v0/${BASE}/${TABLE}?filterByFormula=${encodeURIComponent(`{SKU}="${sku}"`)}`;
    const findResp = await fetch(findUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (!findResp.ok) {
      return new Response(JSON.stringify({ error: "Error buscando producto" }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const findData = await findResp.json();
    const records = findData.records || [];
    
    if (records.length === 0) {
      return new Response(JSON.stringify({ error: `SKU ${sku} no encontrado` }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const recordId = records[0].id;
    const productName = records[0].fields?.Product || sku;

    // Update price
    const updateResp = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${recordId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          "Price MXN": Math.max(0, Math.round(Number(price))),
          "Status": Number(price) > 0 ? "In Stock" : (records[0].fields?.Status || "Out of Stock"),
        },
      }),
    });

    if (!updateResp.ok) {
      const errData = await updateResp.json();
      return new Response(JSON.stringify({ error: errData.error?.message || "Error actualizando" }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `${productName} → MXN $${Number(price).toLocaleString("es-MX")}`,
      sku,
      price: Number(price),
    }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Handler error:", e);
    return new Response(JSON.stringify({ error: "Solicitud inválida" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});