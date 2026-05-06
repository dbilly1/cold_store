-- ============================================================
-- Migration 017: Store units_per_box on stock_additions
--
-- units_per_box can change when a supplier changes box sizes.
-- Recording it at restock time ensures historical price comparisons
-- are always accurate, regardless of future edits to the product.
--
-- Existing rows are back-filled with the product's current value
-- (best approximation available for historical records).
-- ============================================================

-- 1. Add the column
ALTER TABLE stock_additions
  ADD COLUMN IF NOT EXISTS units_per_box numeric(10, 3) DEFAULT NULL;

-- 2. Back-fill from current product definition
UPDATE stock_additions sa
SET    units_per_box = p.units_per_box
FROM   products p
WHERE  sa.product_id    = p.id
  AND  p.units_per_box IS NOT NULL
  AND  sa.units_per_box IS NULL;

-- 3. Update update_stock_on_addition trigger to use NEW.units_per_box
--    with fallback to the product's current value.
--    This makes each restock self-contained — stock calculation uses the
--    box size that was in effect at the time of the restock.
CREATE OR REPLACE FUNCTION update_stock_on_addition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_product         products%ROWTYPE;
  v_new_total_value numeric;
  v_new_total_qty   numeric;
  v_added_qty       numeric;
  v_current_qty     numeric;
  v_upb             numeric; -- units per box for this restock
BEGIN
  SELECT * INTO v_product FROM products WHERE id = NEW.product_id;

  -- Use the units_per_box stored on this restock; fall back to the
  -- product's current value for records that pre-date this migration.
  v_upb := COALESCE(NEW.units_per_box, v_product.units_per_box, 0);

  IF v_product.unit_type = 'kg' THEN
    v_added_qty   := COALESCE(NEW.quantity_kg, 0)
                     + (COALESCE(NEW.quantity_boxes, 0) * v_upb);
    v_current_qty := v_product.current_stock_kg;

  ELSIF v_product.unit_type = 'units' THEN
    v_added_qty   := COALESCE(NEW.quantity_units, 0)
                     + (COALESCE(NEW.quantity_boxes, 0) * v_upb);
    v_current_qty := v_product.current_stock_units;

  ELSE -- 'boxes'
    v_added_qty   := COALESCE(NEW.quantity_boxes, 0);
    v_current_qty := v_product.current_stock_boxes;
  END IF;

  v_new_total_value := (v_product.weighted_avg_cost * v_current_qty)
                       + (NEW.cost_price_per_unit * v_added_qty);
  v_new_total_qty   := v_current_qty + v_added_qty;

  UPDATE products SET
    current_stock_kg =
      current_stock_kg
      + COALESCE(NEW.quantity_kg, 0)
      + (COALESCE(NEW.quantity_boxes, 0)
         * CASE WHEN unit_type = 'kg' THEN v_upb ELSE 0 END),
    current_stock_units =
      current_stock_units
      + COALESCE(NEW.quantity_units, 0)
      + (COALESCE(NEW.quantity_boxes, 0)
         * CASE WHEN unit_type = 'units' THEN v_upb ELSE 0 END),
    current_stock_boxes =
      CASE WHEN unit_type = 'boxes'
        THEN current_stock_boxes + COALESCE(NEW.quantity_boxes, 0)
        ELSE current_stock_boxes  -- frozen at 0 for kg/units
      END,
    weighted_avg_cost =
      CASE WHEN v_new_total_qty > 0
           THEN v_new_total_value / v_new_total_qty
           ELSE 0 END,
    updated_at = now()
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$;
