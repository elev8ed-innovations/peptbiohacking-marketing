import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { isInventoryAdmin } from "../_shared/admin-auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "appoSOvq7flVkIase";
const TABLE = "Shop%20Inventory";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { sku, product, stock, price, passcode } = await req.json();

    if (!isInventoryAdmin(passcode)) {
      return new Response(JSON.stringify({ error: "Código incorrecto" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!sku || !product) {
      return new Response(JSON.stringify({ error: "Faltan SKU o nombre del producto" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const token = Deno.env.get("AIRTABLE_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "Server config error" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Check if SKU already exists
    const findUrl = `https://api.airtable.com/v0/${BASE}/${TABLE}?filterByFormula=${encodeURIComponent(`{SKU}="${sku}"`)}`;
    const findResp = await fetch(findUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (findResp.ok) {
      const findData = await findResp.json();
      if (findData.records && findData.records.length > 0) {
        return new Response(JSON.stringify({
          error: `El SKU "${sku}" ya existe (${findData.records[0].fields?.Product || "producto existente"})`,
        }), {
          status: 409, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    // Create new record in Airtable
    const createResp = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          SKU: sku,
          Product: product,
          Stock: Math.max(0, Math.round(Number(stock) || 0)),
          "Price MXN": Math.max(0, Math.round(Number(price) || 0)),
          Status: Number(price) > 0 && Number(stock) > 0 ? "In Stock" :
                  Number(stock) > 0 && Number(stock) <= 5 ? "Low Stock" :
                  Number(stock) > 0 ? "In Stock" : "Out of Stock",
          "Low Stock Alert": 5,
        },
      }),
    });

    if (!createResp.ok) {
      const errData = await createResp.json();
      return new Response(JSON.stringify({ error: errData.error?.message || "Error creando producto" }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const created = await createResp.json();

    return new Response(JSON.stringify({
      success: true,
      message: `${product} (${sku}) agregado — Stock: ${Number(stock) || 0}`,
      sku,
      product,
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
