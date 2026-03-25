-- ============================================================
-- Stock Recalculation Script
-- Run this once in the Supabase SQL Editor to rebuild all
-- current_stock_kg / current_stock_units / current_stock_boxes
-- and weighted_avg_cost from recorded transaction history.
--
-- What it does:
--   1. Resets all products to zero stock / zero WAC
--   2. Replays every stock_addition in chronological order
--      (same logic as the fixed update_stock_on_addition trigger)
--   3. Replays every active sale item in chronological order
--      (same logic as the fixed deduct_stock_on_sale trigger)
--   4. Replays every applied stock_adjustment in chronological order
--
-- Safe to run multiple times — it always starts from zero.
-- ============================================================

DO $$
DECLARE
  rec        RECORD;
  v_product  products%ROWTYPE;
  v_added_qty       numeric;
  v_current_qty     numeric;
  v_new_total_value numeric;
  v_new_total_qty   numeric;
BEGIN

  -- ──────────────────────────────────────────────────
  -- STEP 1: Reset all products to zero
  -- ──────────────────────────────────────────────────
  UPDATE products SET
    current_stock_kg    = 0,
    current_stock_units = 0,
    current_stock_boxes = 0,
    weighted_avg_cost   = 0,
    updated_at          = NOW();

  RAISE NOTICE 'Step 1 complete: all products reset to zero.';

  -- ──────────────────────────────────────────────────
  -- STEP 2: Replay stock additions (oldest first)
  -- ──────────────────────────────────────────────────
  FOR rec IN
    SELECT * FROM stock_additions ORDER BY created_at ASC
  LOOP
    SELECT * INTO v_product FROM products WHERE id = rec.product_id;

    -- Determine added qty in primary unit
    IF v_product.unit_type = 'kg' THEN
      v_added_qty   := COALESCE(rec.quantity_kg, 0)
                       + (COALESCE(rec.quantity_boxes, 0) * COALESCE(v_product.units_per_box, 0));
      v_current_qty := v_product.current_stock_kg;

    ELSIF v_product.unit_type = 'units' THEN
      v_added_qty   := COALESCE(rec.quantity_units, 0)
                       + (COALESCE(rec.quantity_boxes, 0) * COALESCE(v_product.units_per_box, 0));
      v_current_qty := v_product.current_stock_units;

    ELSE  -- 'boxes'
      v_added_qty   := COALESCE(rec.quantity_boxes, 0);
      v_current_qty := v_product.current_stock_boxes;
    END IF;

    -- Weighted average cost
    v_new_total_value := (v_product.weighted_avg_cost * v_current_qty)
                         + (rec.cost_price_per_unit * v_added_qty);
    v_new_total_qty   := v_current_qty + v_added_qty;

    UPDATE products SET
      current_stock_kg =
        current_stock_kg
        + COALESCE(rec.quantity_kg, 0)
        + (COALESCE(rec.quantity_boxes, 0)
           * CASE WHEN unit_type = 'kg'    THEN COALESCE(units_per_box, 0) ELSE 0 END),
      current_stock_units =
        current_stock_units
        + COALESCE(rec.quantity_units, 0)
        + (COALESCE(rec.quantity_boxes, 0)
           * CASE WHEN unit_type = 'units' THEN COALESCE(units_per_box, 0) ELSE 0 END),
      current_stock_boxes =
        current_stock_boxes + COALESCE(rec.quantity_boxes, 0),
      weighted_avg_cost =
        CASE WHEN v_new_total_qty > 0
             THEN v_new_total_value / v_new_total_qty
             ELSE 0 END,
      updated_at = NOW()
    WHERE id = rec.product_id;
  END LOOP;

  RAISE NOTICE 'Step 2 complete: stock additions replayed.';

  -- ──────────────────────────────────────────────────
  -- STEP 3: Replay active sale items (oldest first)
  --   • Skips soft-deleted sales
  --   • WAC does NOT change on sale (cost-of-sale is a
  --     snapshot at time of sale, not a running average)
  -- ──────────────────────────────────────────────────
  FOR rec IN
    SELECT si.*
    FROM   sale_items si
    JOIN   sales      s  ON s.id = si.sale_id
    WHERE  s.is_deleted = FALSE
    ORDER  BY si.created_at ASC
  LOOP
    UPDATE products SET
      current_stock_kg =
        current_stock_kg
        - COALESCE(rec.quantity_kg, 0)
        - (COALESCE(rec.quantity_boxes, 0)
           * CASE WHEN unit_type = 'kg'    THEN COALESCE(units_per_box, 0) ELSE 0 END),
      current_stock_units =
        current_stock_units
        - COALESCE(rec.quantity_units, 0)
        - (COALESCE(rec.quantity_boxes, 0)
           * CASE WHEN unit_type = 'units' THEN COALESCE(units_per_box, 0) ELSE 0 END),
      current_stock_boxes =
        current_stock_boxes - COALESCE(rec.quantity_boxes, 0),
      updated_at = NOW()
    WHERE id = rec.product_id;
  END LOOP;

  RAISE NOTICE 'Step 3 complete: sale items replayed.';

  -- ──────────────────────────────────────────────────
  -- STEP 4: Replay applied stock adjustments (oldest first)
  --   • Includes: requires_approval=false (auto-applied)
  --   • Includes: requires_approval=true AND approval_status='approved'
  -- ──────────────────────────────────────────────────
  FOR rec IN
    SELECT *
    FROM   stock_adjustments
    WHERE  requires_approval = FALSE
       OR  approval_status   = 'approved'
    ORDER  BY created_at ASC
  LOOP
    UPDATE products SET
      current_stock_kg    = current_stock_kg    + rec.quantity_kg_delta,
      current_stock_units = current_stock_units + rec.quantity_units_delta,
      current_stock_boxes = current_stock_boxes + rec.quantity_boxes_delta,
      updated_at          = NOW()
    WHERE id = rec.product_id;
  END LOOP;

  RAISE NOTICE 'Step 4 complete: stock adjustments replayed.';
  RAISE NOTICE 'Stock recalculation finished successfully.';

END $$;

-- ──────────────────────────────────────────────────
-- Preview the result (run separately to verify)
-- ──────────────────────────────────────────────────
SELECT
  p.name,
  p.unit_type,
  p.current_stock_kg,
  p.current_stock_units,
  p.current_stock_boxes,
  p.weighted_avg_cost,
  CASE
    WHEN p.unit_type = 'kg'    THEN p.current_stock_kg    * p.weighted_avg_cost
    WHEN p.unit_type = 'units' THEN p.current_stock_units * p.weighted_avg_cost
    ELSE                            p.current_stock_boxes * p.weighted_avg_cost
  END AS stock_value
FROM products p
WHERE p.is_active = TRUE
ORDER BY p.name;
