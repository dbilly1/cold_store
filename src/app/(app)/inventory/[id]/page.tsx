import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/require-role";
import { TopBar } from "@/components/layout/top-bar";
import { ProductDetailClient } from "./product-detail-client";
import { notFound } from "next/navigation";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["supervisor", "accountant", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const oneYearAgo = format(subDays(new Date(), 365), "yyyy-MM-dd");

  const [
    { data: product },
    { data: restockHistory },
    { data: salesData },
  ] = await Promise.all([
    supabase
      .from("products")
      .select(`
        id, name, unit_type, units_per_box,
        current_stock_kg, current_stock_units, current_stock_boxes,
        weighted_avg_cost, selling_price, low_stock_threshold,
        variance_threshold_pct, is_active, created_at,
        category:categories(id, name)
      `)
      .eq("id", id)
      .single(),

    supabase
      .from("stock_additions")
      .select(`
        id, created_at, quantity_kg, quantity_units, quantity_boxes,
        cost_price_per_unit, cost_price_per_box, units_per_box,
        supplier, notes
      `)
      .eq("product_id", id)
      .order("created_at", { ascending: false }),

    // Fetch without dot-notation ordering (unsupported on foreign columns).
    // Date filter and sort are handled client-side.
    supabase
      .from("sale_items")
      .select(`
        line_total, unit_price, discount_amount, cost_price_at_sale,
        quantity_kg, quantity_units, quantity_boxes,
        sale:sales!inner(id, sale_date, payment_method, is_deleted)
      `)
      .eq("product_id", id)
      .eq("sale.is_deleted" as never, false)
      .gte("sale.sale_date" as never, oneYearAgo)
      .limit(5000),
  ]);

  if (!product) notFound();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title={product.name} />
      <ProductDetailClient
        product={product as never}
        restockHistory={restockHistory ?? []}
        salesData={(salesData ?? []) as never}
      />
    </div>
  );
}
