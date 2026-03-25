-- ============================================================
-- Fix stock not adjusting when a sale item's quantities are edited
--
-- The existing after_sale_item_insert trigger only fires on INSERT.
-- When handleEditSave() calls sale_items.update() with new quantities,
-- no stock movement happens at all, leaving balances stale.
--
-- Solution: AFTER UPDATE trigger on sale_items that:
--   1. Restores stock by the OLD quantities
--   2. Deducts stock by the NEW quantities
--   3. Only fires when at least one quantity column actually changed
-- ============================================================

create or replace function adjust_stock_on_sale_item_update()
returns trigger language plpgsql security definer as $$
declare
  v_product products%rowtype;
begin
  -- Step 1: restore OLD quantities back into stock
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
      current_stock_boxes + coalesce(old.quantity_boxes, 0),
    updated_at = now()
  where id = new.product_id;

  -- Step 2: deduct NEW quantities from stock
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

  -- Step 3: alert checks on updated stock (same as deduct_stock_on_sale)
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

-- Only fire when at least one quantity column actually changed
-- (price/discount edits alone should not touch stock)
create trigger after_sale_item_update
  after update on sale_items
  for each row
  when (
    old.quantity_kg    is distinct from new.quantity_kg    or
    old.quantity_units is distinct from new.quantity_units or
    old.quantity_boxes is distinct from new.quantity_boxes
  )
  execute procedure adjust_stock_on_sale_item_update();
