-- Tie every Mercado Pago payment to a non-sequential public order identifier.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS public_id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS payment_status_detail TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notifications_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS orders_public_id_key
  ON public.orders (public_id);

CREATE UNIQUE INDEX IF NOT EXISTS orders_mp_preference_id_key
  ON public.orders (mp_preference_id)
  WHERE mp_preference_id IS NOT NULL AND mp_preference_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS orders_mp_payment_id_key
  ON public.orders (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL AND mp_payment_id <> '';

-- Checkout writes use the service-role key inside the Edge Function. Browser/anon
-- inserts bypass server-side price, inventory, and payment validation and must stop.
DROP POLICY IF EXISTS "Allow anon insert" ON public.orders;

COMMENT ON COLUMN public.orders.public_id IS
  'Unpredictable order reference shared with Mercado Pago and the checkout return page.';
COMMENT ON COLUMN public.orders.notifications_sent_at IS
  'Set only after paid-order notifications were accepted by the email provider.';
