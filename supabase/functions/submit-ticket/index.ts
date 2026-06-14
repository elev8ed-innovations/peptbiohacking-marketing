import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const BASE = "appoSOvq7flVkIase";
// This table needs to exist in Airtable with fields: Title, Description, Status, Created, Priority
const TABLE = "Tech%20Tickets";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token = Deno.env.get("AIRTABLE_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "Server config error" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    // GET: retrieve tickets
    if (req.method === "GET") {
      const resp = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=50&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        // Table might not exist yet — return empty
        if (resp.status === 404) {
          return new Response(JSON.stringify({ tickets: [] }), {
            status: 200, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Error fetching tickets" }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const data = await resp.json();
      const tickets = (data.records || []).map((r: any) => ({
        id: r.id,
        title: r.fields?.Title || "",
        description: r.fields?.Description || "",
        status: r.fields?.Status || "Open",
        priority: r.fields?.Priority || "Normal",
        created: r.fields?.Created || "",
        submitter: r.fields?.Submitter || "",
      }));

      return new Response(JSON.stringify({ tickets }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // POST: create ticket
    if (req.method === "POST") {
      const { title, description, priority, submitter, passcode } = await req.json();

      if (passcode !== "PEPBIO2026") {
        return new Response(JSON.stringify({ error: "Código incorrecto" }), {
          status: 401, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      if (!title || !title.trim()) {
        return new Response(JSON.stringify({ error: "El título es obligatorio" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const resp = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            Title: title.trim(),
            Description: (description || "").trim(),
            Status: "Open",
            Priority: priority || "Normal",
            Created: new Date().toISOString(),
            Submitter: (submitter || "Dr. V").trim(),
          },
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json();
        // If table doesn't exist, return a helpful message
        if (resp.status === 404) {
          return new Response(JSON.stringify({
            error: "La tabla 'Tech Tickets' no existe en Airtable. Crea una tabla llamada 'Tech Tickets' con campos: Title (text), Description (text), Status (text), Priority (text), Created (datetime), Submitter (text)",
            needs_table: true,
          }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: errData.error?.message || "Error creando ticket" }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        message: `"${title}" — reportado ✅`,
      }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Handler error:", e);
    return new Response(JSON.stringify({ error: "Solicitud inválida" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});