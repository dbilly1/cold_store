-- ============================================================
-- Database Data Reset Script
-- ============================================================
-- Wipes all transactional data (sales, reconciliations,
-- expenses, customers, adjustments, audits) but keeps:
--   • categories
--   • products (definitions + settings)
--   • stock_additions (your opening/restock entries)
--   • profiles (user accounts)
--   • system_config
--
-- After wiping, it replays your stock_additions through the
-- correct trigger logic so current_stock and weighted_avg_cost
-- on every product are accurate again.
--
-- ⚠️  THIS IS IRREVERSIBLE. There is no undo.
-- ============================================================

BEGIN;

-- ── 1. Clear all transactional tables ───────────────────────
TRUNCATE TABLE
  audit_logs,
  alerts,
  stock_audit_items,
  stock_audits,
  sale_items,
  credit_payments,
  daily_reconciliations,
  expenses,
  sales,
  stock_adjustments,
  customers
RESTART IDENTITY CASCADE;

-- ── 2. Reset product stock counters to zero ─────────────────
UPDATE products SET
  current_stock_kg    = 0,
  current_stock_units = 0,
  current_stock_boxes = 0,
  weighted_avg_cost   = 0,
  updated_at          = NOW();

-- ── 3. Replay stock_additions to rebuild correct balances ────
DO $$
DECLARE
  rec               RECORD;
  v_product         products%ROWTYPE;
  v_added_qty       numeric;
  v_current_qty     numeric;
  v_new_total_value numeric;
  v_new_total_qty   numeric;
BEGIN
  FOR rec IN
    SELECT * FROM stock_additions ORDER BY created_at ASC
  LOOP
    SELECT * INTO v_product FROM products WHERE id = rec.product_id;

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
END $$;

COMMIT;

-- ── Preview restored stock ───────────────────────────────────
SELECT
  p.name,
  p.unit_type,
  CASE p.unit_type
    WHEN 'kg'    THEN p.current_stock_kg::text    || ' kg'
    WHEN 'units' THEN p.current_stock_units::text || ' units'
    ELSE              p.current_stock_boxes::text || ' boxes'
  END                                        AS stock,
  p.weighted_avg_cost                        AS avg_cost,
  CASE p.unit_type
    WHEN 'kg'    THEN p.current_stock_kg    * p.weighted_avg_cost
    WHEN 'units' THEN p.current_stock_units * p.weighted_avg_cost
    ELSE              p.current_stock_boxes * p.weighted_avg_cost
  END                                        AS stock_value
FROM  products p
WHERE p.is_active = TRUE
ORDER BY p.name;
