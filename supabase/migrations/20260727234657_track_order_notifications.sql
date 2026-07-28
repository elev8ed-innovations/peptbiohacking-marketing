alter table public.orders
  add column if not exists clinic_email_status text not null default 'pending'
    check (clinic_email_status in ('pending', 'processing', 'sent', 'error')),
  add column if not exists customer_email_status text not null default 'pending'
    check (customer_email_status in ('pending', 'processing', 'sent', 'error')),
  add column if not exists clinic_email_claimed_at timestamptz,
  add column if not exists customer_email_claimed_at timestamptz,
  add column if not exists clinic_email_sent_at timestamptz,
  add column if not exists customer_email_sent_at timestamptz,
  add column if not exists notification_error text;

create or replace function public.claim_order_notification(
  p_order_id bigint,
  p_kind text
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected_rows integer := 0;
begin
  if p_kind = 'clinic' then
    update public.orders
    set clinic_email_status = 'processing',
        clinic_email_claimed_at = now()
    where id = p_order_id
      and status = 'approved'
      and (
        clinic_email_status in ('pending', 'error')
        or (clinic_email_status = 'processing' and clinic_email_claimed_at < now() - interval '10 minutes')
      );
  elsif p_kind = 'customer' then
    update public.orders
    set customer_email_status = 'processing',
        customer_email_claimed_at = now()
    where id = p_order_id
      and status = 'approved'
      and (
        customer_email_status in ('pending', 'error')
        or (customer_email_status = 'processing' and customer_email_claimed_at < now() - interval '10 minutes')
      );
  else
    raise exception 'Unknown notification kind: %', p_kind;
  end if;

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$$;

revoke all on function public.claim_order_notification(bigint, text) from public, anon, authenticated;
grant execute on function public.claim_order_notification(bigint, text) to service_role;
