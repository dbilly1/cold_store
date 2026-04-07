import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { InventoryClient } from "./inventory-client";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const supabase = await createClient();

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(`
        id, name, unit_type, units_per_box,
        current_stock_kg, current_stock_units, current_stock_boxes,
        weighted_avg_cost, selling_price, low_stock_threshold,
        variance_threshold_pct, is_active, created_at,
        category:categories(id, name)
      `)
      .order("name"),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Inventory" />
      <InventoryClient products={(products ?? []) as never} categories={categories ?? []} />
    </div>
  );
}
