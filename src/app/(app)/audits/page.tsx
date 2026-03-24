import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { AuditsClient } from "./audits-client";

export default async function AuditsPage() {
  const supabase = await createClient();

  const [{ data: products }, { data: audits }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, variance_threshold_pct")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("stock_audits")
      .select(`
        id, audit_type, audit_date, status, notes, completed_at, created_at,
        conducted_by_profile:profiles!stock_audits_conducted_by_fkey(full_name),
        items:stock_audit_items(
          id, product_id, system_stock_kg, system_stock_units, system_stock_boxes,
          physical_stock_kg, physical_stock_units, physical_stock_boxes,
          variance_kg, variance_units, variance_pct, within_threshold, notes,
          product:products(name, unit_type, units_per_box)
        )
      `)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Stock Audits" />
      <AuditsClient products={products ?? []} audits={(audits ?? []) as never} />
    </div>
  );
}
