drop policy if exists "Allow anon insert" on public.orders;
revoke insert on public.orders from anon, authenticated;
