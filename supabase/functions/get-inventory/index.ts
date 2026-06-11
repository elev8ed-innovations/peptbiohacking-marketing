import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const BASE = "appoSOvq7flVkIase";
const TABLE = "Shop%20Inventory";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const token = Deno.env.get("AIRTABLE_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "Inventory unavailable" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Fetch all inventory records
    let allRecords: any[] = [];
    let offset: string | null = null;

    do {
      const url = `https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100${offset ? `&offset=${offset}` : ""}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: "Airtable fetch failed" }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      const data = await resp.json();
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || null;
    } while (offset);

    // Transform to clean output
    const inventory = allRecords.map((r) => {
      const f = r.fields || {};
      return {
        sku: f.SKU || "",
        product: f.Product || "",
        stock: Number(f.Stock) || 0,
        lowAlert: Number(f["Low Stock Alert"]) || 5,
        status: f.Status || "Out of Stock",
        price: f["Price MXN"] || 0,
      };
    });

    // Stats summary
    const totalSKUs = inventory.length;
    const inStock = inventory.filter((i) => i.status === "In Stock").length;
    const lowStock = inventory.filter((i) => i.status === "Low Stock").length;
    const outOfStock = inventory.filter((i) => i.status === "Out of Stock" || i.status === "Discontinued").length;
    const totalUnits = inventory.reduce((s, i) => s + i.stock, 0);

    return new Response(JSON.stringify({
      inventory,
      summary: { totalSKUs, inStock, lowStock, outOfStock, totalUnits },
      updated: new Date().toISOString(),
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Inventory fetch error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});