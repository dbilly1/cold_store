-- Add cost_price_per_box to stock_additions so the original entered value
-- is preserved directly rather than being reverse-calculated from cost_price_per_unit.
--
-- For bulk restocks: user enters cost/box → system already converts to cost/unit for WAC.
--   We now also store the original cost/box.
-- For single restocks: user enters cost/unit → cost/box = cost/unit * units_per_box.
-- For "boxes" products: cost/box = cost/unit (they are the same thing).
-- Existing rows: back-fill as NULL (no units_per_box available here safely).

ALTER TABLE stock_additions
  ADD COLUMN IF NOT EXISTS cost_price_per_box numeric(12, 4) DEFAULT NULL;
