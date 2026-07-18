import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SITE = "https://peptbiohacking.com";
const ALLOWED_ORIGINS = new Set([SITE, "https://www.peptbiohacking.com"]);

function headers(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || SITE;
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : SITE,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { error: "Forbidden" }, 403);

  const publicId = new URL(req.url).searchParams.get("order") || "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publicId)) {
    return json(req, { error: "Invalid order" }, 400);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase service credentials are not configured");

    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?public_id=eq.${encodeURIComponent(publicId)}&select=status`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!response.ok) throw new Error(`Order lookup failed: ${response.status}`);
    const rows = await response.json();
    if (!rows?.[0]) return json(req, { error: "Order not found" }, 404);

    return json(req, { status: rows[0].status }, 200);
  } catch (error) {
    console.error("payment-status error", error);
    return json(req, { error: "Unable to verify payment" }, 500);
  }
});
