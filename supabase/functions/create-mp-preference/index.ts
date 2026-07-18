import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Retired: this endpoint created Mercado Pago preferences without first creating
// an order, so those payments could not be reconciled safely by a webhook.
serve(() =>
  new Response(JSON.stringify({
    error: "Endpoint retired. Use submit-order so every payment is linked to an order.",
  }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  })
);
