-- ============================================================
-- Migration 014: Freeze current_stock_boxes for kg/units products
--
-- For kg and units products, current_stock_boxes is not used
-- anywhere in the UI (est. boxes is derived from current_stock_kg
-- / units_per_box). Keeping it as a live counter causes confusion
-- and drift. This migration makes all four stock triggers treat
-- current_stock_boxes as read-only (no-op) for non-boxes products.
-- ============================================================

-- 1. update_stock_on_addition
create or replace function update_stock_on_addition()
returns trigger language plpgsql security definer as $$
declare
  v_product         products%rowtype;
  v_new_total_value numeric;
  v_new_total_qty   numeric;
  v_added_qty       numeric;
  v_current_qty     numeric;
begin
  select * into v_product from products where id = new.product_id;

  if v_product.unit_type = 'kg' then
    v_added_qty   := coalesce(new.quantity_kg, 0)
                     + (coalesce(new.quantity_boxes, 0) * coalesce(v_product.units_per_box, 0));
    v_current_qty := v_product.current_stock_kg;

  elsif v_product.unit_type = 'units' then
    v_added_qty   := coalesce(new.quantity_units, 0)
                     + (coalesce(new.quantity_boxes, 0) * coalesce(v_product.units_per_box, 0));
    v_current_qty := v_product.current_stock_units;

  else -- 'boxes'
    v_added_qty   := coalesce(new.quantity_boxes, 0);
    v_current_qty := v_product.current_stock_boxes;
  end if;

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
      case when unit_type = 'boxes'
        then current_stock_boxes + coalesce(new.quantity_boxes, 0)
        else current_stock_boxes  -- frozen at 0 for kg/units
      end,
    weighted_avg_cost =
      case when v_new_total_qty > 0
           then v_new_total_value / v_new_total_qty
           else 0 end,
    updated_at = now()
  where id = new.product_id;

  return new;
end;
$$;

-- 2. deduct_stock_on_sale
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
      case when unit_type = 'boxes'
        then current_stock_boxes - coalesce(new.quantity_boxes, 0)
        else current_stock_boxes  -- frozen at 0 for kg/units
      end,
    updated_at = now()
  where id = new.product_id;

  select * into v_product from products where id = new.product_id;

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

-- 3. restore_stock_on_sale_delete
create or replace function restore_stock_on_sale_delete()
returns trigger language plpgsql security definer as $$
declare
  v_item    sale_items%rowtype;
  v_product products%rowtype;
begin
  if new.is_deleted = true and old.is_deleted = false then
    for v_item in select * from sale_items where sale_id = new.id loop
      select * into v_product from products where id = v_item.product_id;

      update products set
        current_stock_kg =
          current_stock_kg
          + coalesce(v_item.quantity_kg, 0)
          + (coalesce(v_item.quantity_boxes, 0)
             * case when unit_type = 'kg' then coalesce(units_per_box, 0) else 0 end),
        current_stock_units =
          current_stock_units
          + coalesce(v_item.quantity_units, 0)
          + (coalesce(v_item.quantity_boxes, 0)
             * case when unit_type = 'units' then coalesce(units_per_box, 0) else 0 end),
        current_stock_boxes =
          case when unit_type = 'boxes'
            then current_stock_boxes + coalesce(v_item.quantity_boxes, 0)
            else current_stock_boxes  -- frozen at 0 for kg/units
          end,
        updated_at = now()
      where id = v_item.product_id;
    end loop;
  end if;
  return new;
end;
$$;

-- 4. adjust_stock_on_sale_item_update
create or replace function adjust_stock_on_sale_item_update()
returns trigger language plpgsql security definer as $$
declare
  v_product products%rowtype;
begin
  -- Restore OLD quantities
  update products set
    current_stock_kg =
      current_stock_kg
      + coalesce(old.quantity_kg, 0)
      + (coalesce(old.quantity_boxes, 0)
         * case when unit_type = 'kg' then coalesce(units_per_box, 0) else 0 end),
    current_stock_units =
      current_stock_units
      + coalesce(old.quantity_units, 0)
      + (coalesce(old.quantity_boxes, 0)
         * case when unit_type = 'units' then coalesce(units_per_box, 0) else 0 end),
    current_stock_boxes =
      case when unit_type = 'boxes'
        then current_stock_boxes + coalesce(old.quantity_boxes, 0)
        else current_stock_boxes
      end,
    updated_at = now()
  where id = new.product_id;

  -- Deduct NEW quantities
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
      case when unit_type = 'boxes'
        then current_stock_boxes - coalesce(new.quantity_boxes, 0)
        else current_stock_boxes
      end,
    updated_at = now()
  where id = new.product_id;

  select * into v_product from products where id = new.product_id;

  if (v_product.unit_type = 'kg'    and v_product.current_stock_kg    < 0) or
     (v_product.unit_type = 'units' and v_product.current_stock_units  < 0) or
     (v_product.unit_type = 'boxes' and v_product.current_stock_boxes  < 0)
  then
    insert into alerts (alert_type, severity, title, message, related_entity_type, related_entity_id)
    values (
      'negative_stock', 'high',
      'Negative Stock Detected',
      'Product "' || v_product.name || '" has gone negative after a sale edit.',
      'products', new.product_id
    );
  end if;

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
