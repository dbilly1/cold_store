-- ============================================================
-- Fix restore_stock_on_sale_delete trigger
--
-- The original trigger (001) only restored the raw column values
-- (quantity_kg, quantity_units, quantity_boxes). But deduct_stock_on_sale
-- (008) also subtracts quantity_boxes * units_per_box from current_stock_kg
-- (for kg products) and current_stock_units (for units products).
-- That box-converted amount was never restored on delete, permanently
-- undercounting stock whenever a sale with box quantities was deleted.
-- ============================================================

create or replace function restore_stock_on_sale_delete()
returns trigger language plpgsql security definer as $$
declare
  v_item     sale_items%rowtype;
  v_product  products%rowtype;
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
          current_stock_boxes + coalesce(v_item.quantity_boxes, 0),
        updated_at = now()
      where id = v_item.product_id;
    end loop;
  end if;
  return new;
end;
$$;
