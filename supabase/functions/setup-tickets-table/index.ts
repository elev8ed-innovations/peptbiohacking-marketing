import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { isInventoryAdmin } from "../_shared/admin-auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "appoSOvq7flVkIase";
const TABLE_NAME = "Tech Tickets";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { passcode } = await req.json();
    if (!isInventoryAdmin(passcode)) {
      return new Response(JSON.stringify({ error: "Código incorrecto" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const token = Deno.env.get("AIRTABLE_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "No Airtable token" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Create the table via Airtable REST API (tables endpoint)
    const resp = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: TABLE_NAME,
        description: "Tech tickets and recommendations from Dr. V and team",
        fields: [
          { name: "Title", type: "singleLineText" },
          { name: "Description", type: "multilineText" },
          { name: "Status", type: "singleLineText" },
          { name: "Priority", type: "singleLineText" },
          { name: "Created", type: "dateTime", options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "America/Hermosillo" } },
          { name: "Submitter", type: "singleLineText" },
        ],
      }),
    });

    const data = await resp.json();
    
    if (!resp.ok) {
      return new Response(JSON.stringify({
        error: data.error?.message || data.error || "Failed to create table",
        details: data,
      }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Table "${TABLE_NAME}" created successfully in Airtable`,
      tableId: data.id,
      tableName: data.name,
    }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Setup error:", e);
    const message = e instanceof Error ? e.message : "Setup failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
