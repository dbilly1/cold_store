import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { SalesClient } from "./sales-client";
import { format } from "date-fns";

export default async function SalesPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [{ data: products }, { data: todaySales }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, selling_price, weighted_avg_cost")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("sales")
      .select(`
        id, sale_date, total_amount, discount_amount, payment_method,
        is_deleted, delete_reason, created_at,
        recorded_by_profile:profiles!sales_recorded_by_fkey(full_name),
        items:sale_items(
          id, product_id, quantity_kg, quantity_units, quantity_boxes,
          unit_price, discount_amount, line_total,
          product:products(name, unit_type)
        )
      `)
      .eq("sale_date", today)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Sales" />
      <SalesClient products={(products ?? []) as never} initialSales={(todaySales ?? []) as never} />
    </div>
  );
}
