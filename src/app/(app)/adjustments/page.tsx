import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { AdjustmentsClient } from "./adjustments-client";

export const dynamic = "force-dynamic";

export default async function AdjustmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).single();

  const [{ data: products }, { data: adjustments }] = await Promise.all([
    supabase.from("products").select("id, name, unit_type, current_stock_kg, current_stock_units, current_stock_boxes, variance_threshold_pct").eq("is_active", true).order("name"),
    supabase.from("stock_adjustments").select(`
      id, reason, reason_detail, quantity_kg_delta, quantity_units_delta, quantity_boxes_delta,
      stock_before_kg, stock_before_units, approval_status, requires_approval, created_at,
      adjusted_by,
      product:products(name, unit_type),
      adjusted_by_profile:profiles!stock_adjustments_adjusted_by_fkey(full_name),
      approved_by_profile:profiles!stock_adjustments_approved_by_fkey(full_name)
    `).order("created_at", { ascending: false }).limit(50),
  ]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Stock Adjustments" />
      <AdjustmentsClient
        products={products ?? []}
        adjustments={(adjustments ?? []) as never}
        userRole={(profile?.role as string) ?? "salesperson"}
      />
    </div>
  );
}
