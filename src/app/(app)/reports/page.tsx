import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ReportsClient } from "./reports-client";
import { format, subDays } from "date-fns";

export default async function ReportsPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const [{ data: salesData }, { data: expenseData }, { data: productSales }] = await Promise.all([
    // Daily sales for last 30 days
    supabase
      .from("sales")
      .select("sale_date, total_amount, payment_method, items:sale_items(line_total, cost_price_at_sale, quantity_kg, quantity_units)")
      .gte("sale_date", thirtyDaysAgo)
      .eq("is_deleted", false)
      .order("sale_date"),

    // Expenses for last 30 days
    supabase
      .from("expenses")
      .select("expense_date, amount, category")
      .gte("expense_date", thirtyDaysAgo)
      .order("expense_date"),

    // Per-product sales
    supabase
      .from("sale_items")
      .select(`
        product_id, quantity_kg, quantity_units, line_total, cost_price_at_sale,
        product:products(name, unit_type),
        sale:sales!inner(sale_date, is_deleted)
      `)
      .gte("sale.sale_date" as never, thirtyDaysAgo)
      .eq("sale.is_deleted" as never, false),
  ]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Reports" />
      <ReportsClient
        salesData={salesData ?? []}
        expenseData={expenseData ?? []}
        productSalesData={(productSales ?? []) as never}
      />
    </div>
  );
}
