import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const response = await fetch(
      `${supabaseUrl}/rest/v1/products?select=sku,name,unit,price_mxn,stock_on_hand,low_stock_threshold,active&order=name`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!response.ok) throw new Error(`Inventory query failed: ${response.status}`);

    const products = await response.json();
    const inventory = products.map((product: any) => ({
      sku: product.sku,
      product: product.name,
      unit: product.unit,
      stock: Number(product.stock_on_hand) || 0,
      lowAlert: Number(product.low_stock_threshold) || 5,
      status: !product.active ? "Discontinued"
        : product.stock_on_hand <= 0 ? "Out of Stock"
        : product.stock_on_hand <= product.low_stock_threshold ? "Low Stock"
        : "In Stock",
      price: Number(product.price_mxn) || 0,
    }));

    const active = inventory.filter((item: any) => item.status !== "Discontinued");
    return new Response(JSON.stringify({
      inventory,
      summary: {
        totalSKUs: active.length,
        inStock: active.filter((item: any) => item.status === "In Stock").length,
        lowStock: active.filter((item: any) => item.status === "Low Stock").length,
        outOfStock: active.filter((item: any) => item.status === "Out of Stock").length,
        totalUnits: active.reduce((sum: number, item: any) => sum + item.stock, 0),
      },
      updated: new Date().toISOString(),
    }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Inventory fetch error:", error);
    return new Response(JSON.stringify({ error: "Inventory unavailable" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
