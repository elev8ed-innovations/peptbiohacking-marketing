import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const BASE = "appoSOvq7flVkIase";
const TABLE = "NIL%20Likeness";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const token = Deno.env.get("AIRTABLE_TOKEN");
    if (!token) {
      return new Response(JSON.stringify({ error: "NIL data unavailable" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

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

    const nilData = allRecords.map((r: any) => {
      const f = r.fields || {};
      return {
        name: f.Player || "",
        school: f.School || "",
        sport: (f.Sport || "basketball").toLowerCase(),
        pos: f.Pos || "",
        ht: f.Ht || "",
        ppg: f.PPG || "-",
        "3p": f["3P"] || "-",
        followers: Number(f.Followers) || 0,
        engagement: Number(f.Engagement) || 0,
        growth: Number(f.Growth) || 0,
        nilScore: Number(f["NIL Score"]) || 0,
        draftProj: f["Draft Proj"] || "Undrafted",
        grab: (f.Grab || "no").toLowerCase(),
      };
    });

    nilData.sort((a: any, b: any) => b.nilScore - a.nilScore);

    return new Response(JSON.stringify({ nil: nilData, updated: new Date().toISOString() }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
