import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { isInventoryAdmin } from "../_shared/admin-auth.ts";

const SITE = "https://peptbiohacking.com";
const ALLOWED_ORIGINS = new Set([SITE, "https://www.peptbiohacking.com"]);

function headers(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || SITE;
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : SITE,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: headers(req) });
  }

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: headers(req) });
  }

  const body = await req.json().catch(() => ({}));
  if (!isInventoryAdmin(body.passcode)) {
    return new Response(JSON.stringify({ error: "Codigo incorrecto" }), { status: 401, headers: headers(req) });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: headers(req) });
});
