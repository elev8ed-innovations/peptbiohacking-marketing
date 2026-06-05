import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: cors });

  try {
    const body = await req.json();

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await sb
      .from("assessments")
      .insert({
        full_name:           body.name || null,
        age:                 body.age || null,
        whatsapp:            body.whatsapp || null,
        email:               body.email || null,
        weight_kg:           body.weight || null,
        height_cm:           body.height || null,
        sex:                 body.sex || null,
        city:                body.city || null,
        goals:               body.goals || [],
        symptoms:            body.symptoms || [],
        medications:         body.medications || null,
        activity:            body.activity || null,
        sleep:               body.sleep || null,
        stress:              body.stress || null,
        peptide_experience:  body.peptide_experience || null,
        suggested_protocol:  body.suggested_protocol || null,
        recommended:         body.recommended || [],
        lang:                body.lang || "es",
        raw:                 body,
      })
      .select("id")
      .single();

    if (error) throw new Error("DB: " + error.message);

    /* ── Email Dr. V via Resend ─────────────────────────── */
    const rk = Deno.env.get("RESEND_API_KEY");
    if (rk) {
      const g = (body.goals || []).join(", ") || "—";
      const s = (body.symptoms || []).join(", ") || "—";
      const recs = (body.recommended || [])
        .map((r: any) => r.name + " — " + r.why)
        .join("<br>");
      const row = (label: string, val: string) =>
        `<tr><td style="padding:6px 12px;font-weight:bold;white-space:nowrap">${label}</td><td style="padding:6px 12px">${val || "—"}</td></tr>`;

      const html = `
<h2 style="color:#1a3a5c">Nueva Evaluación — PeptBiohacking</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;width:100%;max-width:560px">
${row("Nombre", body.name)}
${row("Edad", body.age)}
${row("WhatsApp", body.whatsapp)}
${row("Email", body.email)}
${row("Peso (kg)", body.weight)}
${row("Estatura (cm)", body.height)}
${row("Sexo", body.sex)}
${row("Ciudad", body.city)}
${row("Metas", g)}
${row("Síntomas", s)}
${row("Medicamentos", body.medications)}
${row("Actividad", body.activity)}
${row("Sueño", body.sleep)}
${row("Estrés", body.stress)}
${row("Experiencia previa", body.peptide_experience)}
${row("Protocolo sugerido", body.suggested_protocol)}
${row("Idioma", body.lang)}
</table>
${recs ? `<h3 style="color:#1a3a5c;margin-top:20px">Péptidos Recomendados</h3><p style="font-family:sans-serif;font-size:14px">${recs}</p>` : ""}
<p style="margin-top:16px;color:#999;font-size:11px">ID: ${data.id} · Guardado automáticamente en Supabase</p>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + rk,
        },
        body: JSON.stringify({
          from: "PeptBiohacking <noreply@peptbiohacking.mx>",
          to: ["Mdsportsmedicineandent@gmail.com"],
          subject: "Nueva evaluación: " + (body.name || "Paciente"),
          html,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message || String(e) }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
