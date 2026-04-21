-- ============================================================
-- Migration 012: Fix double stock deduction on sale edit
-- ============================================================
-- Bug: edit_sale_atomic (011) manually applied a stock delta
-- after updating sale_items. But the after_sale_item_update
-- trigger (009) already fires on that UPDATE and does the same
-- restore-old / deduct-new adjustment. The result was every edit
-- deducted the quantity difference twice.
--
-- Fix: remove the manual stock block from edit_sale_atomic.
-- The trigger is the single source of truth for stock on UPDATE.
-- ============================================================

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

    -- Update the sale item.
    -- NOTE: the after_sale_item_update trigger (009_fix_sale_item_update_stock)
    -- fires automatically on this UPDATE and handles the full stock adjustment:
    --   restore OLD quantities → deduct NEW quantities.
    -- Do NOT add any manual stock update here — that would double-deduct.
    update public.sale_items set
      quantity_kg     = v_new_kg,
      quantity_units  = v_new_units,
      quantity_boxes  = v_new_boxes,
      unit_price      = coalesce((v_item->>'unit_price')::numeric, unit_price),
      discount_amount = coalesce((v_item->>'discount_amount')::numeric, discount_amount),
      line_total      = v_line_total
    where id = (v_item->>'id')::uuid;

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
