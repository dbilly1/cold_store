import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ReconciliationClient } from "./reconciliation-client";
import { format, subDays } from "date-fns";

export interface RecorderSales {
  recorder_id: string;
  recorder_name: string;
  system_cash: number;
  system_mobile: number;
  cash_expenses: number;
}

export interface DayRecorderData {
  date: string;
  recorders: RecorderSales[];
}

export default async function ReconciliationPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  // Sales with recorder info
  const { data: allSales } = await supabase
    .from("sales")
    .select("sale_date, recorded_by, total_amount, payment_method, recorder:profiles!sales_recorded_by_fkey(id, full_name)")
    .eq("is_deleted", false)
    .gte("sale_date", thirtyDaysAgo);

  // Till expenses with recorder info
  const { data: tillExpenses } = await supabase
    .from("expenses")
    .select("expense_date, recorded_by, amount")
    .eq("paid_from_till", true)
    .gte("expense_date", thirtyDaysAgo);

  // Group by (date, recorder_id)
  const byDateRecorder = new Map<string, Map<string, { name: string; cash: number; mobile: number; expenses: number }>>();

  allSales?.forEach((s) => {
    const recorder = s.recorder as { id: string; full_name: string } | null;
    const recorderId = s.recorded_by ?? "unknown";
    const recorderName = recorder?.full_name ?? "Unknown";
    if (!byDateRecorder.has(s.sale_date)) byDateRecorder.set(s.sale_date, new Map());
    const dateMap = byDateRecorder.get(s.sale_date)!;
    const existing = dateMap.get(recorderId) ?? { name: recorderName, cash: 0, mobile: 0, expenses: 0 };
    existing.cash += s.payment_method === "cash" ? s.total_amount : 0;
    existing.mobile += s.payment_method === "mobile_money" ? s.total_amount : 0;
    dateMap.set(recorderId, existing);
  });

  tillExpenses?.forEach((e) => {
    const recorderId = e.recorded_by ?? "unknown";
    if (!byDateRecorder.has(e.expense_date)) byDateRecorder.set(e.expense_date, new Map());
    const dateMap = byDateRecorder.get(e.expense_date)!;
    const existing = dateMap.get(recorderId) ?? { name: "Unknown", cash: 0, mobile: 0, expenses: 0 };
    existing.expenses += e.amount;
    dateMap.set(e.expense_date, existing);
  });

  const days: DayRecorderData[] = Array.from(byDateRecorder.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, recorderMap]) => ({
      date,
      recorders: Array.from(recorderMap.entries()).map(([recorder_id, v]) => ({
        recorder_id,
        recorder_name: v.name,
        system_cash: v.cash,
        system_mobile: v.mobile,
        cash_expenses: v.expenses,
      })),
    }));

  // Reconciliations (now per date+recorder)
  const { data: reconciliations } = await supabase
    .from("daily_reconciliations")
    .select(`
      id, reconciliation_date, recorded_by, system_cash_total, system_mobile_total,
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
        days={days}
        reconciliations={(reconciliations ?? []) as never}
      />
    </div>
  );
}
