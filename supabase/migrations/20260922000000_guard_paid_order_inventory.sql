-- Lock the order before checking approval, so concurrent webhook deliveries cannot
-- apply inventory twice or replace the payment attached to an approved order.
create or replace function public.apply_paid_order_inventory(
  p_order_id bigint,
  p_payment_id text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  order_status text;
  existing_payment_id text;
  order_products jsonb;
  item jsonb;
  current_stock integer;
  requested_qty integer;
  item_sku text;
begin
  select status, mp_payment_id, products
    into order_status, existing_payment_id, order_products
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order not found');
  end if;

  if order_status = 'approved' then
    if existing_payment_id = p_payment_id then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already approved with another payment');
  end if;

  for item in select value from jsonb_array_elements(order_products)
  loop
    item_sku := item->>'sku';
    requested_qty := greatest(1, (item->>'qty')::integer);

    select stock_on_hand into current_stock
    from public.products
    where sku = item_sku
    for update;

    if current_stock is null then
      raise exception 'Unknown inventory SKU: %', item_sku;
    end if;
    if current_stock < requested_qty then
      raise exception 'Insufficient stock for %: have %, need %', item_sku, current_stock, requested_qty;
    end if;

    update public.products
    set stock_on_hand = stock_on_hand - requested_qty, updated_at = now()
    where sku = item_sku;

    insert into public.inventory_movements
      (sku, quantity_delta, movement_type, order_id, mp_payment_id, note)
    values
      (item_sku, -requested_qty, 'sale', p_order_id, p_payment_id, 'Mercado Pago approved');
  end loop;

  update public.orders
  set status = 'approved', mp_payment_id = p_payment_id
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'duplicate', false);
end;
$$;

revoke all on function public.apply_paid_order_inventory(bigint, text) from public, anon, authenticated;
grant execute on function public.apply_paid_order_inventory(bigint, text) to service_role;
