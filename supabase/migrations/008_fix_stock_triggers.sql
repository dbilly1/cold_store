-- ============================================================
-- Fix stock triggers for boxes-type products
-- ============================================================

-- ----------------------------------------------------------------
-- 1. update_stock_on_addition
--    BUG: For 'boxes' unit_type, v_added_qty was always 0 because
--    the trigger fell into the 'else' (units) branch and computed
--    quantity_units + quantity_boxes * units_per_box, where both
--    quantity_units and units_per_box are NULL/0 for boxes products.
--    This made WAC calculation incorrect (divided by 0, left as 0).
-- ----------------------------------------------------------------
create or replace function update_stock_on_addition()
returns trigger language plpgsql security definer as $$
declare
  v_product products%rowtype;
  v_new_total_value numeric;
  v_new_total_qty   numeric;
  v_added_qty       numeric; -- in primary unit (kg, units, or boxes)
  v_current_qty     numeric; -- current stock in primary unit
begin
  select * into v_product from products where id = new.product_id;

  -- Determine added qty in primary unit
  if v_product.unit_type = 'kg' then
    v_added_qty := coalesce(new.quantity_kg, 0)
      + (coalesce(new.quantity_boxes, 0) * coalesce(v_product.units_per_box, 0));
    v_current_qty := v_product.current_stock_kg;

  elsif v_product.unit_type = 'units' then
    v_added_qty := coalesce(new.quantity_units, 0)
      + (coalesce(new.quantity_boxes, 0) * coalesce(v_product.units_per_box, 0));
    v_current_qty := v_product.current_stock_units;

  else -- 'boxes'
    -- Primary unit IS the box; units_per_box not relevant for WAC
    v_added_qty   := coalesce(new.quantity_boxes, 0);
    v_current_qty := v_product.current_stock_boxes;
  end if;

  -- Weighted average cost calculation
  v_new_total_value := (v_product.weighted_avg_cost * v_current_qty)
                       + (new.cost_price_per_unit * v_added_qty);
  v_new_total_qty   := v_current_qty + v_added_qty;

  update products set
    current_stock_kg =
      current_stock_kg
      + coalesce(new.quantity_kg, 0)
      + (coalesce(new.quantity_boxes, 0)
         * case when unit_type = 'kg' then coalesce(units_per_box, 0) else 0 end),
    current_stock_units =
      current_stock_units
      + coalesce(new.quantity_units, 0)
      + (coalesce(new.quantity_boxes, 0)
         * case when unit_type = 'units' then coalesce(units_per_box, 0) else 0 end),
    current_stock_boxes =
      current_stock_boxes + coalesce(new.quantity_boxes, 0),
    weighted_avg_cost =
      case when v_new_total_qty > 0
           then v_new_total_value / v_new_total_qty
           else 0 end,
    updated_at = now()
  where id = new.product_id;

  return new;
end;
$$;

-- ----------------------------------------------------------------
-- 2. deduct_stock_on_sale
--    BUG A: Low-stock and negative-stock alerts only checked
--    current_stock_kg / current_stock_units, so boxes products
--    never triggered alerts.
--    BUG B: (no trigger change needed for box-sync — the boxes
--    column for kg/units products is now derived in the UI from
--    current_stock_kg / units_per_box instead of being tracked
--    separately, which is cleaner and avoids fractional box issues.)
-- ----------------------------------------------------------------
create or replace function deduct_stock_on_sale()
returns trigger language plpgsql security definer as $$
declare
  v_product products%rowtype;
begin
  select * into v_product from products where id = new.product_id;

  update products set
    current_stock_kg =
      current_stock_kg
      - coalesce(new.quantity_kg, 0)
      - (coalesce(new.quantity_boxes, 0)
         * case when unit_type = 'kg' then coalesce(units_per_box, 0) else 0 end),
    current_stock_units =
      current_stock_units
      - coalesce(new.quantity_units, 0)
      - (coalesce(new.quantity_boxes, 0)
         * case when unit_type = 'units' then coalesce(units_per_box, 0) else 0 end),
    current_stock_boxes =
      current_stock_boxes - coalesce(new.quantity_boxes, 0),
    updated_at = now()
  where id = new.product_id;

  -- Re-read updated stock for alert checks
  select * into v_product from products where id = new.product_id;

  -- Negative stock alert — check the relevant primary column
  if (v_product.unit_type = 'kg'    and v_product.current_stock_kg    < 0) or
     (v_product.unit_type = 'units' and v_product.current_stock_units  < 0) or
     (v_product.unit_type = 'boxes' and v_product.current_stock_boxes  < 0)
  then
    insert into alerts (alert_type, severity, title, message, related_entity_type, related_entity_id)
    values (
      'negative_stock', 'high',
      'Negative Stock Detected',
      'Product "' || v_product.name || '" has gone negative after a sale.',
      'products', new.product_id
    );
  end if;

  -- Low stock alert — check the relevant primary column
  if (v_product.unit_type = 'kg'    and v_product.current_stock_kg    <= v_product.low_stock_threshold) or
     (v_product.unit_type = 'units' and v_product.current_stock_units  <= v_product.low_stock_threshold) or
     (v_product.unit_type = 'boxes' and v_product.current_stock_boxes  <= v_product.low_stock_threshold)
  then
    insert into alerts (alert_type, severity, title, message, related_entity_type, related_entity_id)
    values (
      'low_stock', 'medium',
      'Low Stock Warning',
      'Product "' || v_product.name || '" is at or below low stock threshold.',
      'products', new.product_id
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------
-- 3. restore_stock_on_sale_delete
--    The existing restore was correct for the raw column values
--    stored on sale_items (quantity_kg, quantity_units, quantity_boxes).
--    No change needed — boxes-type products record quantity_boxes
--    on the sale item and the restore adds it back correctly.
--    For kg/units products the boxes column is now UI-derived, so
--    no box adjustment is required here either.
-- ----------------------------------------------------------------
-- (No change needed — kept as-is from 001_initial_schema.sql)
