-- Replaces the multi-step client-side handleEditSave loop.
-- Accepts the sale header fields + a JSONB array of updated items.
-- All updates (sale_items + stock deltas + sale header) happen in one transaction.
create or replace function public.edit_sale_atomic(
  p_sale_id        uuid,
  p_sale_date      date,
  p_payment_method text,
  p_customer_id    uuid,
  p_items          jsonb
)
returns numeric
language plpgsql
security definer
as $$
declare
  v_item        jsonb;
  v_old         sale_items%rowtype;
  v_prod        products%rowtype;
  v_new_kg      numeric;
  v_new_units   numeric;
  v_new_boxes   numeric;
  v_eff_qty     numeric;
  v_line_total  numeric;
  v_new_total   numeric := 0;
  v_delta_kg    numeric;
  v_delta_units numeric;
  v_delta_boxes numeric;
begin
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_old
    from public.sale_items
    where id = (v_item->>'id')::uuid;

    if not found then
      raise exception 'sale_item not found: %', v_item->>'id';
    end if;

    select * into v_prod
    from public.products
    where id = v_old.product_id;

    v_new_kg    := coalesce((v_item->>'quantity_kg')::numeric,    0);
    v_new_units := coalesce((v_item->>'quantity_units')::numeric, 0);
    v_new_boxes := coalesce((v_item->>'quantity_boxes')::numeric, 0);

    -- Mirror client-side lineTotal: effective qty depends on unit_type
    if v_prod.unit_type = 'boxes' then
      v_eff_qty := v_new_boxes;
    elsif v_prod.unit_type = 'kg' then
      v_eff_qty := v_new_kg;
    else
      v_eff_qty := v_new_units;
    end if;

    v_line_total := greatest(
      0,
      v_eff_qty * coalesce((v_item->>'unit_price')::numeric, 0)
      - coalesce((v_item->>'discount_amount')::numeric, 0)
    );

    v_new_total := v_new_total + v_line_total;

    update public.sale_items set
      quantity_kg     = v_new_kg,
      quantity_units  = v_new_units,
      quantity_boxes  = v_new_boxes,
      unit_price      = coalesce((v_item->>'unit_price')::numeric, unit_price),
      discount_amount = coalesce((v_item->>'discount_amount')::numeric, discount_amount),
      line_total      = v_line_total
    where id = (v_item->>'id')::uuid;

    -- Stock delta: negative = stock was over-deducted (qty went down), restore it
    v_delta_kg    := -(v_new_kg    - coalesce(v_old.quantity_kg,    0));
    v_delta_units := -(v_new_units - coalesce(v_old.quantity_units, 0));
    v_delta_boxes := -(v_new_boxes - coalesce(v_old.quantity_boxes, 0));

    if v_delta_kg != 0 or v_delta_units != 0 or v_delta_boxes != 0 then
      update public.products set
        current_stock_kg    = current_stock_kg    + v_delta_kg,
        current_stock_units = current_stock_units + v_delta_units,
        current_stock_boxes = current_stock_boxes + v_delta_boxes,
        updated_at          = now()
      where id = v_old.product_id;
    end if;
  end loop;

  update public.sales set
    sale_date      = p_sale_date,
    payment_method = p_payment_method::public.payment_method,
    customer_id    = p_customer_id,
    total_amount   = v_new_total,
    updated_at     = now()
  where id = p_sale_id;

  return v_new_total;
end;
$$;
