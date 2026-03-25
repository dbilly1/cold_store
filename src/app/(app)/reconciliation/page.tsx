import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ReconciliationClient } from "./reconciliation-client";
import { format, subDays } from "date-fns";

export interface SessionExpense {
  id: string;
  category: string;
  description: string;
  amount: number;
}

export interface SessionData {
  session_key: string;   // batch_id (UUID) or "direct"
  session_label: string; // "Session 1", "Session 2", ...
  session_time: string;  // earliest created_at in the group
  system_cash: number;
  system_mobile: number;
  session_expenses: SessionExpense[]; // saved till expenses for this session (bulk only)
}

export interface DaySessionData {
  date: string;
  sessions: SessionData[];
  cash_expenses: number; // direct-only till expenses (batch_id IS NULL)
}

export default async function ReconciliationPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  type SaleRow = {
    sale_date: string;
    total_amount: number;
    payment_method: string;
    created_at: string;
    batch_id: string | null;
  };

  type ExpenseRow = {
    id: string;
    expense_date: string;
    category: string;
    description: string;
    amount: number;
    batch_id: string | null;
  };

  // Sales — need batch_id and created_at for session grouping
  const { data: allSalesRaw } = await supabase
    .from("sales")
    .select("sale_date, total_amount, payment_method, created_at, batch_id")
    .eq("is_deleted", false)
    .gte("sale_date", thirtyDaysAgo);
  const allSales = (allSalesRaw ?? []) as unknown as SaleRow[];

  // Till expenses — fetch full detail so we can split direct vs bulk session
  const { data: tillExpensesRaw } = await supabase
    .from("expenses")
    .select("id, expense_date, category, description, amount, batch_id")
    .eq("paid_from_till", true)
    .gte("expense_date", thirtyDaysAgo);
  const tillExpenses = (tillExpensesRaw ?? []) as unknown as ExpenseRow[];

  // Group by (sale_date, session_key)
  type SessionAccum = { cash: number; mobile: number; time: string };
  const byDateSession = new Map<string, Map<string, SessionAccum>>();

  allSales.forEach((s) => {
    const sessionKey = s.batch_id ?? "direct";
    if (!byDateSession.has(s.sale_date)) byDateSession.set(s.sale_date, new Map());
    const dateMap = byDateSession.get(s.sale_date)!;
    const ex = dateMap.get(sessionKey) ?? { cash: 0, mobile: 0, time: s.created_at };
    ex.cash += s.payment_method === "cash" ? s.total_amount : 0;
    ex.mobile += s.payment_method === "mobile_money" ? s.total_amount : 0;
    if (s.created_at < ex.time) ex.time = s.created_at; // keep earliest
    dateMap.set(sessionKey, ex);
  });

  // Direct till expenses: batch_id IS NULL → go into cash_expenses per date
  const expensesByDate = new Map<string, number>();
  // Bulk session expenses: batch_id IS NOT NULL → go into session_expenses per batch_id
  const expensesByBatch = new Map<string, SessionExpense[]>();

  tillExpenses.forEach((e) => {
    if (!e.batch_id) {
      expensesByDate.set(e.expense_date, (expensesByDate.get(e.expense_date) ?? 0) + e.amount);
    } else {
      if (!expensesByBatch.has(e.batch_id)) expensesByBatch.set(e.batch_id, []);
      expensesByBatch.get(e.batch_id)!.push({
        id: e.id,
        category: e.category,
        description: e.description,
        amount: e.amount,
      });
    }
  });

  const days: DaySessionData[] = Array.from(byDateSession.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, sessionMap]) => {
      const sessions: SessionData[] = Array.from(sessionMap.entries())
        .sort(([, a], [, b]) => a.time.localeCompare(b.time)) // chronological
        .map(([session_key, v], idx) => ({
          session_key,
          session_label: `Session ${idx + 1}`,
          session_time: v.time,
          system_cash: v.cash,
          system_mobile: v.mobile,
          // Bulk sessions carry their own expenses; direct sessions use cash_expenses
          session_expenses: session_key !== "direct"
            ? (expensesByBatch.get(session_key) ?? [])
            : [],
        }));
      return { date, sessions, cash_expenses: expensesByDate.get(date) ?? 0 };
    });

  // Reconciliations
  const { data: reconciliations } = await supabase
    .from("daily_reconciliations")
    .select(`
      id, reconciliation_date, session_key, system_cash_total, system_mobile_total,
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
