import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ReconciliationClient } from "./reconciliation-client";
import { format, subDays } from "date-fns";

export interface DayWithSales {
  date: string;
  system_cash: number;
  system_mobile: number;
}

export default async function ReconciliationPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  // All sales (last 30 days) grouped by date for system totals
  const { data: allSales } = await supabase
    .from("sales")
    .select("sale_date, total_amount, payment_method")
    .eq("is_deleted", false)
    .gte("sale_date", thirtyDaysAgo)
    .order("sale_date", { ascending: false });

  // Group by date
  const byDate = new Map<string, { cash: number; mobile: number }>();
  allSales?.forEach((s) => {
    const ex = byDate.get(s.sale_date) ?? { cash: 0, mobile: 0 };
    ex.cash += s.payment_method === "cash" ? s.total_amount : 0;
    ex.mobile += s.payment_method === "mobile_money" ? s.total_amount : 0;
    byDate.set(s.sale_date, ex);
  });

  const daysWithSales: DayWithSales[] = Array.from(byDate.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, v]) => ({ date, system_cash: v.cash, system_mobile: v.mobile }));

  // All reconciliations for the same period
  const { data: reconciliations } = await supabase
    .from("daily_reconciliations")
    .select(`
      id, reconciliation_date, system_cash_total, system_mobile_total,
      actual_cash_entered, actual_mobile_entered, cash_variance, mobile_variance,
      status, notes, created_at,
      submitted_by_profile:profiles!daily_reconciliations_submitted_by_fkey(full_name)
    `)
    .gte("reconciliation_date", thirtyDaysAgo)
    .order("reconciliation_date", { ascending: false });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Daily Reconciliation" />
      <ReconciliationClient
        today={today}
        daysWithSales={daysWithSales}
        reconciliations={(reconciliations ?? []) as never}
      />
    </div>
  );
}
