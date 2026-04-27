import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/require-role";
import { TopBar } from "@/components/layout/top-bar";
import { ReportsClient } from "./reports-client";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireRole(["supervisor", "accountant", "admin"]);
  const supabase = await createClient();
  // Fetch one year so the client date-picker has real data for any reasonable range
  const oneYearAgo = format(subDays(new Date(), 365), "yyyy-MM-dd");

  const [
    { data: salesData },
    { data: expenseData },
    { data: productSales },
    { data: creditPaymentsData },
    { data: reconData },
    { data: allTimeCreditSalesData },
    { data: allTimeCreditPaidData },
  ] = await Promise.all([
    // Sales — include quantity_boxes for correct COGS; include payment_method for split
    supabase
      .from("sales")
      .select(
        "sale_date, total_amount, payment_method, items:sale_items(line_total, cost_price_at_sale, quantity_kg, quantity_units, quantity_boxes)",
      )
      .gte("sale_date", oneYearAgo)
      .eq("is_deleted", false)
      .order("sale_date", { ascending: false })
      .limit(20000),

    // Expenses — all within data window, no stale cache
    supabase
      .from("expenses")
      .select("expense_date, amount, category")
      .gte("expense_date", oneYearAgo)
      .order("expense_date", { ascending: false })
      .limit(5000),

    // Per-product sales with server-side date filter to avoid fetching all-time data
    supabase
      .from("sale_items")
      .select(
        `product_id, quantity_kg, quantity_units, quantity_boxes, line_total, cost_price_at_sale,
         product:products(name, unit_type),
         sale:sales!inner(sale_date, is_deleted, payment_method)`,
      )
      .eq("sale.is_deleted" as never, false)
      .gte("sale.sale_date" as never, oneYearAgo)
      .limit(50000),

    // Credit repayments within the date window (for period breakdown)
    supabase
      .from("credit_payments")
      .select("customer_id, amount, payment_method, payment_date")
      .gte("payment_date", oneYearAgo)
      .limit(5000),

    // Reconciliation sessions (for variance summary)
    supabase
      .from("daily_reconciliations")
      .select("reconciliation_date, cash_variance, mobile_variance, status")
      .gte("reconciliation_date", oneYearAgo)
      .order("reconciliation_date", { ascending: false })
      .limit(2000),

    // All-time credit sales total (no date filter — needed for accurate outstanding balance)
    supabase
      .from("sales")
      .select("total_amount")
      .eq("payment_method", "credit")
      .eq("is_deleted", false)
      .limit(50000),

    // All-time credit payments total (no date filter)
    supabase
      .from("credit_payments")
      .select("amount")
      .limit(50000),
  ]);

  const allTimeCreditIssued = (allTimeCreditSalesData ?? []).reduce((s, r) => s + r.total_amount, 0);
  const allTimeCreditPaid = (allTimeCreditPaidData ?? []).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Reports" />
      <ReportsClient
        salesData={salesData ?? []}
        expenseData={expenseData ?? []}
        productSalesData={(productSales ?? []) as never}
        creditPaymentsData={creditPaymentsData ?? []}
        reconData={reconData ?? []}
        dataStartDate={oneYearAgo}
        allTimeCreditIssued={allTimeCreditIssued}
        allTimeCreditPaid={allTimeCreditPaid}
      />
    </div>
  );
}
