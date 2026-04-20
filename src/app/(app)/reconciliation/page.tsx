import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ReconciliationClient } from "./reconciliation-client";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

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
  credit_cash: number;   // cash repayments received (direct session only)
  credit_mobile: number; // mobile repayments received (direct session only)
  session_expenses: SessionExpense[]; // saved till expenses for this session (bulk only)
}

export interface DaySessionData {
  date: string;
  sessions: SessionData[];
  cash_expenses: number; // direct-only till expenses (batch_id IS NULL)
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(0, parseInt(params?.page ?? "0") || 0);

  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  // Page 0: [today-14, today], Page 1: [today-29, today-15], etc.
  const rangeEnd = format(subDays(new Date(), page * PAGE_SIZE), "yyyy-MM-dd");
  const rangeStart = format(subDays(new Date(), (page + 1) * PAGE_SIZE - 1), "yyyy-MM-dd");

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

  type CreditPaymentRow = {
    customer_id: string;
    amount: number;
    payment_method: string;
    payment_date: string;
    created_at: string;
  };

  const [
    { data: allSalesRaw },
    { data: tillExpensesRaw },
    { data: creditPaymentsRaw },
    { count: olderCount },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("sale_date, total_amount, payment_method, created_at, batch_id")
      .eq("is_deleted", false)
      .gte("sale_date", rangeStart)
      .lte("sale_date", rangeEnd)
      .order("sale_date", { ascending: false })
      .limit(2000),

    supabase
      .from("expenses")
      .select("id, expense_date, category, description, amount, batch_id")
      .eq("paid_from_till", true)
      .gte("expense_date", rangeStart)
      .lte("expense_date", rangeEnd)
      .limit(500),

    supabase
      .from("credit_payments")
      .select("customer_id, amount, payment_method, payment_date, created_at")
      .gte("payment_date", rangeStart)
      .lte("payment_date", rangeEnd)
      .limit(500),

    // Peek one row older than rangeStart to know if there's a next page
    supabase
      .from("sales")
      .select("id", { count: "exact", head: true })
      .eq("is_deleted", false)
      .lt("sale_date", rangeStart),
  ]);

  const allSales = (allSalesRaw ?? []) as unknown as SaleRow[];
  const tillExpenses = (tillExpensesRaw ?? []) as unknown as ExpenseRow[];
  const creditPayments = (creditPaymentsRaw ?? []) as unknown as CreditPaymentRow[];
  const hasMore = (olderCount ?? 0) > 0;

  // Group by (sale_date, session_key)
  type SessionAccum = { cash: number; mobile: number; time: string; credit_cash: number; credit_mobile: number };
  const byDateSession = new Map<string, Map<string, SessionAccum>>();

  allSales.forEach((s) => {
    if (s.payment_method === "credit") return;
    const sessionKey = s.batch_id ?? "direct";
    if (!byDateSession.has(s.sale_date)) byDateSession.set(s.sale_date, new Map());
    const dateMap = byDateSession.get(s.sale_date)!;
    const ex = dateMap.get(sessionKey) ?? { cash: 0, mobile: 0, time: s.created_at, credit_cash: 0, credit_mobile: 0 };
    ex.cash += s.payment_method === "cash" ? s.total_amount : 0;
    ex.mobile += s.payment_method === "mobile_money" ? s.total_amount : 0;
    if (s.created_at < ex.time) ex.time = s.created_at;
    dateMap.set(sessionKey, ex);
  });

  const expensesByDate = new Map<string, number>();
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

  creditPayments.forEach((p) => {
    if (!byDateSession.has(p.payment_date)) byDateSession.set(p.payment_date, new Map());
    const dateMap = byDateSession.get(p.payment_date)!;
    const ex = dateMap.get("direct") ?? { cash: 0, mobile: 0, time: p.created_at, credit_cash: 0, credit_mobile: 0 };
    if (p.payment_method === "cash") ex.credit_cash += p.amount;
    else if (p.payment_method === "mobile_money") ex.credit_mobile += p.amount;
    if (p.created_at < ex.time) ex.time = p.created_at;
    dateMap.set("direct", ex);
  });

  const days: DaySessionData[] = Array.from(byDateSession.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, sessionMap]) => {
      const sessions: SessionData[] = Array.from(sessionMap.entries())
        .sort(([, a], [, b]) => a.time.localeCompare(b.time))
        .map(([session_key, v], idx) => ({
          session_key,
          session_label: `Session ${idx + 1}`,
          session_time: v.time,
          system_cash: v.cash,
          system_mobile: v.mobile,
          credit_cash: v.credit_cash,
          credit_mobile: v.credit_mobile,
          session_expenses: session_key !== "direct"
            ? (expensesByBatch.get(session_key) ?? [])
            : [],
        }));
      return { date, sessions, cash_expenses: expensesByDate.get(date) ?? 0 };
    });

  const { data: reconciliations } = await supabase
    .from("daily_reconciliations")
    .select(`
      id, reconciliation_date, session_key, system_cash_total, system_mobile_total,
      actual_cash_entered, actual_mobile_entered, cash_variance, mobile_variance,
      status, notes, created_at,
      submitted_by_profile:profiles!daily_reconciliations_submitted_by_fkey(full_name)
    `)
    .gte("reconciliation_date", rangeStart)
    .lte("reconciliation_date", rangeEnd)
    .order("reconciliation_date", { ascending: false });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Daily Reconciliation" />
      <ReconciliationClient
        today={today}
        defaultDate={rangeEnd}
        days={days}
        reconciliations={(reconciliations ?? []) as never}
        page={page}
        hasMore={hasMore}
      />
    </div>
  );
}
