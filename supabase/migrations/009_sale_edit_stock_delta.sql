-- ============================================================
-- Migration 009: RPC for applying stock delta on sale item edit
-- ============================================================
-- When a sale item's quantity is edited in the UI, the DB triggers
-- (deduct_stock_on_sale, restore_stock_on_sale_delete) don't fire
-- because they only respond to INSERT and soft-delete, not UPDATE.
-- This function atomically applies the quantity difference to the
-- product's current stock so inventory stays accurate after edits.
-- ============================================================

create or replace function public.apply_sale_item_stock_delta(
  p_product_id  uuid,
  p_delta_kg    numeric,
  p_delta_units numeric,
  p_delta_boxes numeric
)
returns void
language plpgsql
security definer
as $$
begin
  update public.products
  set
    current_stock_kg    = current_stock_kg    + p_delta_kg,
    current_stock_units = current_stock_units + p_delta_units,
    current_stock_boxes = current_stock_boxes + p_delta_boxes,
    updated_at          = now()
  where id = p_product_id;
end;
$$;
