import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ReconciliationClient } from "./reconciliation-client";
import { format } from "date-fns";

export default async function ReconciliationPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");

  // Get today's sales totals
  const { data: todaySales } = await supabase
    .from("sales")
    .select("total_amount, payment_method")
    .eq("sale_date", today)
    .eq("is_deleted", false);

  const systemCash = todaySales?.filter(s => s.payment_method === "cash").reduce((s, sale) => s + sale.total_amount, 0) ?? 0;
  const systemMobile = todaySales?.filter(s => s.payment_method === "mobile_money").reduce((s, sale) => s + sale.total_amount, 0) ?? 0;

  // Check if already submitted today
  const { data: existing } = await supabase
    .from("daily_reconciliations")
    .select("*")
    .eq("reconciliation_date", today)
    .maybeSingle();

  // Recent reconciliations
  const { data: history } = await supabase
    .from("daily_reconciliations")
    .select(`
      id, reconciliation_date, system_cash_total, system_mobile_total,
      actual_cash_entered, actual_mobile_entered, cash_variance, mobile_variance,
      status, notes, created_at,
      submitted_by_profile:profiles!daily_reconciliations_submitted_by_fkey(full_name)
    `)
    .order("reconciliation_date", { ascending: false })
    .limit(14);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Daily Reconciliation" />
      <ReconciliationClient
        systemCash={systemCash}
        systemMobile={systemMobile}
        existing={existing}
        history={(history ?? []) as never}
        today={today}
      />
    </div>
  );
}
