-- Create orders table for PeptBiohacking shop
CREATE TABLE IF NOT EXISTS public.orders (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  products JSONB NOT NULL DEFAULT '[]',
  total INTEGER NOT NULL,
  upsell BOOLEAN NOT NULL DEFAULT FALSE,
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Allow edge function to insert (uses service_role key - bypasses RLS)
-- Allow admin to read all orders
CREATE POLICY "Allow service role full access"
  ON public.orders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anon to insert (for checkout flow)
CREATE POLICY "Allow anon insert"
  ON public.orders
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Quick verification
SELECT count(*) FROM public.orders;