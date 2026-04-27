import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { SalesClient } from "./sales-client";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 30;

export interface DailySummary {
  date: string;
  count: number;
  revenue: number;
  cash: number;
  mobile: number;
  cash_variance: number | null;
  mobile_variance: number | null;
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(0, parseInt(params?.page ?? "0") || 0);
  const pageSize = Math.max(1, parseInt(params?.pageSize ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE);

  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");

  // Current user role
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();
  const role = profileRow?.role ?? "salesperson";
  const isSalesperson = role === "salesperson";

  // Always fetch today's detailed sales (for the single-sale panel)
  const { data: todaySales } = await supabase
    .from("sales")
    .select(`
      id, sale_date, total_amount, discount_amount, payment_method,
      is_deleted, delete_reason, created_at, customer_id,
      recorded_by_profile:profiles!sales_recorded_by_fkey(full_name),
      items:sale_items(
        id, product_id, quantity_kg, quantity_units, quantity_boxes,
        unit_price, discount_amount, line_total,
        product:products(name, unit_type)
      )
    `)
    .eq("sale_date", today)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  const { data: products } = await supabase
    .from("products")
    .select("id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, selling_price, weighted_avg_cost")
    .eq("is_active", true)
    .order("name");

  const { data: customers } = await supabase
    .from("customers")
    .select("id, full_name, phone")
    .order("full_name");

  let dailySummaries: DailySummary[] = [];
  let total = 0;

  if (!isSalesperson) {
    // Step 1: get all distinct sale dates (lightweight — just date strings)
    const { data: allDateRows } = await supabase
      .from("sales")
      .select("sale_date")
      .eq("is_deleted", false)
      .limit(50000);

    const allDates = [...new Set((allDateRows ?? []).map((r: { sale_date: string }) => r.sale_date))]
      .sort((a, b) => b.localeCompare(a));
    total = allDates.length;

    const pageDates = allDates.slice(page * pageSize, (page + 1) * pageSize);

    if (pageDates.length > 0) {
      // Step 2: fetch sales + reconciliations only for this page's exact dates
      const [{ data: allSales }, { data: reconciliations }] = await Promise.all([
        supabase
          .from("sales")
          .select("sale_date, total_amount, payment_method")
          .eq("is_deleted", false)
          .in("sale_date", pageDates)
          .limit(5000),
        supabase
          .from("daily_reconciliations")
          .select("reconciliation_date, cash_variance, mobile_variance")
          .in("reconciliation_date", pageDates),
      ]);

      const reconMap = new Map<string, { cash_variance: number; mobile_variance: number }>();
      reconciliations?.forEach((r) => {
        reconMap.set(r.reconciliation_date, {
          cash_variance: r.cash_variance ?? 0,
          mobile_variance: r.mobile_variance ?? 0,
        });
      });

      const byDate = new Map<string, { count: number; revenue: number; cash: number; mobile: number }>();
      allSales?.forEach((s) => {
        const ex = byDate.get(s.sale_date) ?? { count: 0, revenue: 0, cash: 0, mobile: 0 };
        ex.count += 1;
        ex.revenue += s.total_amount;
        ex.cash += s.payment_method === "cash" ? s.total_amount : 0;
        ex.mobile += s.payment_method === "mobile_money" ? s.total_amount : 0;
        byDate.set(s.sale_date, ex);
      });

      dailySummaries = pageDates.map((date) => {
        const sums = byDate.get(date) ?? { count: 0, revenue: 0, cash: 0, mobile: 0 };
        const recon = reconMap.get(date);
        return {
          date,
          ...sums,
          cash_variance: recon?.cash_variance ?? null,
          mobile_variance: recon?.mobile_variance ?? null,
        };
      });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Sales" />
      <SalesClient
        products={(products ?? []) as never}
        initialSales={(todaySales ?? []) as never}
        userRole={role}
        dailySummaries={dailySummaries}
        customers={(customers ?? []) as never}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
}
