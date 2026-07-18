import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { sendPaidOrderNotifications, type PaidOrder } from "../_shared/order-notifications.ts";

type MercadoPagoPayment = {
  id: number;
  live_mode: boolean;
  status: string;
  status_detail?: string;
  currency_id: string;
  transaction_amount: number;
  external_reference?: string;
};

type OrderRow = PaidOrder & {
  status: string;
  mp_payment_id: string | null;
  notifications_sent_at: string | null;
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseSignature(header: string): { ts: string; hash: string } | null {
  const values = new Map(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")] as const;
    }),
  );
  const ts = values.get("ts");
  const hash = values.get("v1");
  return ts && hash ? { ts, hash } : null;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyWebhook(req: Request, dataId: string): Promise<boolean> {
  const secret = Deno.env.get("MP_WEBHOOK_SECRET") || "";
  const requestId = req.headers.get("x-request-id") || "";
  const parsed = parseSignature(req.headers.get("x-signature") || "");
  if (!secret || !requestId || !parsed || !dataId) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parsed.ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  return constantTimeEqual(hex(digest), parsed.hash.toLowerCase());
}

function supabaseConfig(): { url: string; key: string } {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) throw new Error("Supabase service credentials are not configured");
  return { url, key };
}

async function getOrder(publicId: string): Promise<OrderRow | null> {
  const { url, key } = supabaseConfig();
  const select = "public_id,customer_name,phone,email,address,city,state,zip,products,total,upsell,status,mp_payment_id,notifications_sent_at";
  const request = await fetch(
    `${url}/rest/v1/orders?public_id=eq.${encodeURIComponent(publicId)}&select=${select}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!request.ok) throw new Error(`Order lookup failed: ${request.status}`);
  const rows = await request.json();
  return rows?.[0] || null;
}

async function updateOrder(publicId: string, patch: Record<string, unknown>): Promise<void> {
  const { url, key } = supabaseConfig();
  const request = await fetch(`${url}/rest/v1/orders?public_id=eq.${encodeURIComponent(publicId)}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!request.ok) throw new Error(`Order update failed: ${request.status}`);
}

async function getPayment(paymentId: string): Promise<MercadoPagoPayment> {
  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) throw new Error("MP_ACCESS_TOKEN is not configured");
  const request = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payment = await request.json();
  if (!request.ok) throw new Error(`Mercado Pago payment lookup failed: ${request.status}`);
  return payment;
}

function orderStatus(paymentStatus: string): string {
  switch (paymentStatus) {
    case "approved": return "paid";
    case "pending":
    case "in_process":
    case "authorized": return "pending_payment";
    case "refunded": return "refunded";
    case "charged_back": return "charged_back";
    case "cancelled": return "cancelled";
    case "rejected": return "payment_rejected";
    default: return "payment_review";
  }
}

serve(async (req) => {
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const eventType = String(body.type || url.searchParams.get("type") || "");
    const dataId = String(url.searchParams.get("data.id") || body.data?.id || "");

    if (!(await verifyWebhook(req, dataId))) {
      console.warn("Rejected Mercado Pago webhook with invalid signature");
      return response({ error: "Invalid signature" }, 401);
    }
    if (eventType && eventType !== "payment") return response({ received: true });

    const payment = await getPayment(dataId);
    const publicId = String(payment.external_reference || "");
    const order = publicId ? await getOrder(publicId) : null;
    if (!order) {
      console.warn("Payment has no matching order", payment.id, publicId);
      return response({ received: true });
    }

    const productionExpected = (Deno.env.get("MP_ENVIRONMENT") || "production") === "production";
    const modeMatches = payment.live_mode === productionExpected;
    const amountMatches = payment.currency_id === "MXN" && Number(payment.transaction_amount) === Number(order.total);
    if (!modeMatches || !amountMatches) {
      console.error("Payment verification mismatch", {
        paymentId: payment.id,
        modeMatches,
        amountMatches,
      });
      await updateOrder(publicId, {
        mp_payment_id: String(payment.id),
        payment_status_detail: payment.status_detail || null,
        status: "payment_review",
      });
      return response({ received: true });
    }

    await updateOrder(publicId, {
      mp_payment_id: String(payment.id),
      payment_status_detail: payment.status_detail || null,
      paid_at: payment.status === "approved" ? new Date().toISOString() : null,
      status: orderStatus(payment.status),
    });

    if (payment.status === "approved" && !order.notifications_sent_at) {
      const sent = await sendPaidOrderNotifications(order);
      if (sent) await updateOrder(publicId, { notifications_sent_at: new Date().toISOString() });
    }

    return response({ received: true });
  } catch (error) {
    console.error("mercado-pago-webhook error", error);
    return response({ error: "Temporary webhook failure" }, 500);
  }
});
