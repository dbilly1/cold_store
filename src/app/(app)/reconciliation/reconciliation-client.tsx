"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { CheckCircle, AlertTriangle, Calculator, ChevronLeft, ChevronRight, Layers, Receipt, Plus, Trash2, RefreshCw } from "lucide-react";
import type { DaySessionData, SessionData } from "./page";
import type { ExpenseCategory } from "@/types/database";

const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "electricity", label: "Electricity" },
  { value: "transport", label: "Transport" },
  { value: "wages", label: "Wages" },
  { value: "rent", label: "Rent" },
  { value: "maintenance", label: "Maintenance" },
  { value: "packaging", label: "Packaging" },
  { value: "cleaning", label: "Cleaning" },
  { value: "miscellaneous", label: "Miscellaneous" },
];

interface Reconciliation {
  id: string;
  reconciliation_date: string;
  session_key: string | null;
  system_cash_total: number;
  system_mobile_total: number;
  actual_cash_entered: number;
  actual_mobile_entered: number;
  cash_variance: number;
  mobile_variance: number;
  status: string;
  notes: string | null;
  created_at: string;
  submitted_by_profile: { full_name: string } | null;
}

type FormEntry = { cash: string; mobile: string; notes: string };

interface PendingExpense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
}

export function ReconciliationClient({
  today,
  defaultDate,
  days,
  reconciliations: initialRecons,
  page,
  hasMore,
}: {
  today: string;
  defaultDate: string;
  days: DaySessionData[];
  reconciliations: Reconciliation[];
  page: number;
  hasMore: boolean;
}) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>(initialRecons);
  const [selectedDate, setSelectedDate] = useState(defaultDate);

  // Reset local state when page changes (pagination navigation)
  useEffect(() => {
    setSelectedDate(defaultDate);
    setReconciliations(initialRecons);
    setFormState({});
    setPendingExpenses({});
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRefresh() {
    startTransition(() => router.refresh());
  }
  const [formState, setFormState] = useState<Record<string, FormEntry>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [pendingExpenses, setPendingExpenses] = useState<Record<string, PendingExpense[]>>({});

  // Populate form from existing reconciliations when date changes
  useEffect(() => {
    const dateRecords = reconciliations.filter((r) => r.reconciliation_date === selectedDate);
    const initial: Record<string, FormEntry> = {};
    dateRecords.forEach((r) => {
      if (r.session_key) {
        initial[r.session_key] = {
          cash: r.actual_cash_entered?.toString() ?? "",
          mobile: r.actual_mobile_entered?.toString() ?? "",
          notes: r.notes ?? "",
        };
      }
    });
    setFormState(initial);
    setPendingExpenses({});
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedDay = days.find((d) => d.date === selectedDate);

  function updateForm(sessionKey: string, patch: Partial<FormEntry>) {
    setFormState((prev) => ({
      ...prev,
      [sessionKey]: { ...prev[sessionKey] ?? { cash: "", mobile: "", notes: "" }, ...patch },
    }));
  }

  function addExpense(sessionKey: string) {
    setPendingExpenses((prev) => ({
      ...prev,
      [sessionKey]: [
        ...(prev[sessionKey] ?? []),
        { id: crypto.randomUUID(), category: "miscellaneous", description: "", amount: "" },
      ],
    }));
  }

  function updateExpense(sessionKey: string, id: string, patch: Partial<PendingExpense>) {
    setPendingExpenses((prev) => ({
      ...prev,
      [sessionKey]: (prev[sessionKey] ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }

  function removeExpense(sessionKey: string, id: string) {
    setPendingExpenses((prev) => ({
      ...prev,
      [sessionKey]: (prev[sessionKey] ?? []).filter((e) => e.id !== id),
    }));
  }

  // Lookup: "date|session_key" → reconciliation
  const reconLookup = new Map<string, Reconciliation>();
  reconciliations.forEach((r) => {
    if (r.session_key) reconLookup.set(`${r.reconciliation_date}|${r.session_key}`, r);
  });

  async function handleSubmit(session: SessionData) {
    const form = formState[session.session_key] ?? { cash: "", mobile: "", notes: "" };
    if (!form.cash && !form.mobile) {
      toast({ title: "Enter actual amounts", variant: "destructive" });
      return;
    }
    setSaving((prev) => ({ ...prev, [session.session_key]: true }));
    const supabase = createClient();

    // Save any pending expenses first
    const validExpenses = (pendingExpenses[session.session_key] ?? []).filter(
      (e) => e.description.trim() && parseFloat(e.amount) > 0
    );
    if (validExpenses.length > 0) {
      await supabase.from("expenses").insert(
        validExpenses.map((e) => ({
          expense_date: selectedDate,
          category: e.category,
          description: e.description.trim(),
          amount: parseFloat(e.amount),
          paid_from_till: true,
          recorded_by: profile!.id,
          batch_id: session.session_key !== "direct" ? session.session_key : null,
        }))
      );
    }

    const newExpensesTotal = validExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const savedExpensesTotal = session.session_expenses.reduce((s, e) => s + e.amount, 0);
    const cash = parseFloat(form.cash) || 0;
    const mobile = parseFloat(form.mobile) || 0;
    const isBulkSession = session.session_key !== "direct";
    const dayTillExpenses = !isBulkSession ? (selectedDay?.cash_expenses ?? 0) : 0;
    const expectedCash = session.system_cash + session.credit_cash - dayTillExpenses - savedExpensesTotal - newExpensesTotal;
    const cashV = cash - expectedCash;
    const mobileV = mobile - (session.system_mobile + session.credit_mobile);
    const status = cashV === 0 && mobileV === 0 ? "balanced" : "flagged";

    const { data, error } = await supabase
      .from("daily_reconciliations")
      .upsert(
        {
          reconciliation_date: selectedDate,
          submitted_by: profile!.id,
          session_key: session.session_key,
          system_cash_total: expectedCash,
          system_mobile_total: session.system_mobile + session.credit_mobile,
          actual_cash_entered: cash,
          actual_mobile_entered: mobile,
          status,
          notes: form.notes || null,
        },
        { onConflict: "reconciliation_date,session_key" },
      )
      .select(`*, submitted_by_profile:profiles!daily_reconciliations_submitted_by_fkey(full_name)`)
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving((prev) => ({ ...prev, [session.session_key]: false }));
      return;
    }

    if (status === "flagged") {
      const { error: alertErr } = await supabase.from("alerts").insert({
        alert_type: "cash_mismatch",
        severity: "high",
        title: "Cash Reconciliation Mismatch",
        message: `${formatDate(selectedDate)} — ${session.session_label} — Cash: ${formatCurrency(cashV)}, Mobile: ${formatCurrency(mobileV)}`,
        related_entity_type: "daily_reconciliations",
        related_entity_id: data.id,
      });
      if (alertErr) console.warn("Reconciliation alert insert failed:", alertErr.message);
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "SUBMIT_RECONCILIATION",
      entity_type: "daily_reconciliations",
      entity_id: data.id,
      new_value: { date: selectedDate, session: session.session_label, cash_variance: cashV, mobile_variance: mobileV, status },
    });

    setReconciliations((prev) => [
      data as Reconciliation,
      ...prev.filter((r) => !(r.reconciliation_date === selectedDate && r.session_key === session.session_key)),
    ]);
    // Clear pending expenses for this session
    setPendingExpenses((prev) => ({ ...prev, [session.session_key]: [] }));

    // Refresh server data so history and session totals are always current
    startTransition(() => router.refresh());

    if (status === "balanced") {
      toast({ title: "Balanced!", variant: "success" as never });
    } else {
      const parts: string[] = [];
      if (cashV > 0) parts.push(`Cash surplus: +${formatCurrency(cashV)}`);
      else if (cashV < 0) parts.push(`Cash shortfall: ${formatCurrency(cashV)}`);
      if (mobileV > 0) parts.push(`Mobile surplus: +${formatCurrency(mobileV)}`);
      else if (mobileV < 0) parts.push(`Mobile shortfall: ${formatCurrency(mobileV)}`);
      toast({
        title: cashV < 0 || mobileV < 0 ? "Shortfall flagged" : "Surplus flagged",
        description: parts.join(" · "),
        variant: "destructive",
      });
    }
    setSaving((prev) => ({ ...prev, [session.session_key]: false }));
  }

  // Right-panel date list
  const allDates = new Set<string>();
  days.forEach((d) => allDates.add(d.date));
  reconciliations.forEach((r) => allDates.add(r.reconciliation_date));
  const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));

  function getDayStatus(date: string): { label: string; color: string } {
    const dayData = days.find((d) => d.date === date);
    const sessions = dayData?.sessions ?? [];
    if (sessions.length === 0) return { label: "No sales", color: "text-slate-400" };
    const recons = sessions
      .map((s) => reconLookup.get(`${date}|${s.session_key}`))
      .filter(Boolean) as Reconciliation[];
    if (recons.length === 0) return { label: "Pending", color: "text-slate-400" };
    if (recons.length < sessions.length)
      return { label: `Partial (${recons.length}/${sessions.length})`, color: "text-amber-600 font-medium" };
    if (recons.every((r) => r.status === "balanced"))
      return { label: "Balanced", color: "text-green-600 font-medium" };
    // Determine shortfall vs surplus from stored variances
    const hasShortfall = recons.some((r) => r.cash_variance < 0 || r.mobile_variance < 0);
    const hasSurplus = recons.some((r) => r.cash_variance > 0 || r.mobile_variance > 0);
    if (hasShortfall && hasSurplus) return { label: "Mixed", color: "text-amber-600 font-medium" };
    if (hasShortfall) return { label: "Shortfall", color: "text-red-600 font-medium" };
    return { label: "Surplus", color: "text-amber-600 font-medium" };
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left: Session forms ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Calculator className="h-4 w-4 text-blue-500" />
            <h2 className="font-semibold">Reconcile a Day</h2>
            <div className="flex items-center gap-2 ml-auto">
              <Label className="text-sm whitespace-nowrap">Date</Label>
              <Input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 text-sm w-full sm:w-36"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 flex-shrink-0"
                onClick={handleRefresh}
                disabled={isPending}
                title="Refresh data"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          {selectedDate !== today && (
            <p className="text-xs text-amber-600 font-medium">Backdated entry for {formatDate(selectedDate)}</p>
          )}

          {!selectedDay || selectedDay.sessions.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-400">
                No sales recorded for {formatDate(selectedDate)}
              </CardContent>
            </Card>
          ) : (
            selectedDay.sessions.map((session) => {
              const existing = reconLookup.get(`${selectedDate}|${session.session_key}`);
              const form = formState[session.session_key] ?? { cash: "", mobile: "", notes: "" };
              const isBulk = session.session_key !== "direct";
              const dayTillExpenses = !isBulk ? (selectedDay.cash_expenses ?? 0) : 0;
              const savedExpensesTotal = session.session_expenses.reduce((s, e) => s + e.amount, 0);
              const pendingList = pendingExpenses[session.session_key] ?? [];
              const pendingExpensesTotal = pendingList.reduce(
                (s, e) => s + (parseFloat(e.amount) || 0), 0
              );
              const expectedCash = session.system_cash + session.credit_cash - dayTillExpenses - savedExpensesTotal - pendingExpensesTotal;
              const expectedMobile = session.system_mobile + session.credit_mobile;
              const cashVariance = (parseFloat(form.cash) || 0) - expectedCash;
              const mobileVariance = (parseFloat(form.mobile) || 0) - expectedMobile;
              const isBalanced = cashVariance === 0 && mobileVariance === 0;
              const isSaving = saving[session.session_key] ?? false;

              return (
                <Card key={session.session_key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        {isBulk
                          ? <Layers className="h-4 w-4 text-blue-400" />
                          : <Receipt className="h-4 w-4 text-slate-400" />}
                        <span>{session.session_label}</span>
                        <span className="text-xs font-normal text-slate-400">
                          {isBulk ? "Bulk entry" : "Direct entries"} · {formatDateTime(session.session_time).split(",")[1]?.trim()}
                        </span>
                      </span>
                      {existing && (
                        <Badge
                          variant={existing.status === "balanced" ? ("success" as never) : "destructive"}
                          className="text-xs"
                        >
                          {existing.status === "balanced" ? "Balanced" : "Mismatch"}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* System totals */}
                    <div className="bg-slate-50 rounded-lg p-3 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Cash Sales</span>
                        <span className="font-medium">{formatCurrency(session.system_cash)}</span>
                      </div>
                      {session.credit_cash > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-purple-600">+ Credit Repayments</span>
                          <span className="text-purple-600">{formatCurrency(session.credit_cash)}</span>
                        </div>
                      )}
                      {session.credit_mobile > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-purple-600">+ Credit Repayments (Mobile)</span>
                          <span className="text-purple-600">{formatCurrency(session.credit_mobile)}</span>
                        </div>
                      )}
                      {dayTillExpenses > 0 && (
                        <div className="flex justify-between text-amber-700">
                          <span>Till Expenses (day)</span>
                          <span className="font-medium">− {formatCurrency(dayTillExpenses)}</span>
                        </div>
                      )}
                      {session.session_expenses.map((exp) => (
                        <div key={exp.id} className="flex justify-between text-amber-700">
                          <span className="truncate mr-2">{exp.description || exp.category}</span>
                          <span className="font-medium whitespace-nowrap">− {formatCurrency(exp.amount)}</span>
                        </div>
                      ))}
                      {pendingExpensesTotal > 0 && (
                        <div className="flex justify-between text-amber-700">
                          <span>New Expenses</span>
                          <span className="font-medium">− {formatCurrency(pendingExpensesTotal)}</span>
                        </div>
                      )}
                      {(dayTillExpenses > 0 || savedExpensesTotal > 0 || pendingExpensesTotal > 0) && (
                        <div className="flex justify-between font-semibold border-t pt-1.5">
                          <span>Expected Cash</span>
                          <span>{formatCurrency(expectedCash)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Mobile Money</span>
                        <span className="font-medium">{formatCurrency(expectedMobile)}</span>
                      </div>
                    </div>

                    {/* Actual inputs */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Actual Cash</Label>
                        <Input
                          type="number" min="0" step="0.01"
                          value={form.cash}
                          onChange={(e) => updateForm(session.session_key, { cash: e.target.value })}
                          placeholder="0.00"
                          className="h-8 text-sm"
                        />
                        {form.cash && (
                          <p className={`text-xs font-medium ${cashVariance === 0 ? "text-green-600" : cashVariance > 0 ? "text-blue-600" : "text-red-600"}`}>
                            {cashVariance > 0 ? "+" : ""}{formatCurrency(cashVariance)}
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Actual Mobile</Label>
                        <Input
                          type="number" min="0" step="0.01"
                          value={form.mobile}
                          onChange={(e) => updateForm(session.session_key, { mobile: e.target.value })}
                          placeholder="0.00"
                          className="h-8 text-sm"
                        />
                        {form.mobile && (
                          <p className={`text-xs font-medium ${mobileVariance === 0 ? "text-green-600" : mobileVariance > 0 ? "text-blue-600" : "text-red-600"}`}>
                            {mobileVariance > 0 ? "+" : ""}{formatCurrency(mobileVariance)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Input
                        value={form.notes}
                        onChange={(e) => updateForm(session.session_key, { notes: e.target.value })}
                        placeholder="Optional explanation..."
                        className="h-8 text-sm"
                      />
                    </div>

                    {/* Session expenses */}
                    <div className="space-y-2 border-t pt-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-slate-500">Add expenses paid from till</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs gap-1 px-2 text-slate-600"
                          onClick={() => addExpense(session.session_key)}
                        >
                          <Plus className="h-3 w-3" /> Add
                        </Button>
                      </div>
                      {pendingList.map((exp) => (
                        <div key={exp.id} className="flex gap-1.5 items-center">
                          <Select
                            value={exp.category}
                            onValueChange={(v) => updateExpense(session.session_key, exp.id, { category: v as ExpenseCategory })}
                          >
                            <SelectTrigger className="h-7 text-xs w-28 flex-shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {EXPENSE_CATEGORIES.map((c) => (
                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            className="h-7 text-xs flex-1 min-w-0"
                            value={exp.description}
                            onChange={(e) => updateExpense(session.session_key, exp.id, { description: e.target.value })}
                            placeholder="Description"
                          />
                          <Input
                            type="number" min="0" step="0.01"
                            className="h-7 text-xs w-20 flex-shrink-0"
                            value={exp.amount}
                            onChange={(e) => updateExpense(session.session_key, exp.id, { amount: e.target.value })}
                            placeholder="0.00"
                          />
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-slate-400 flex-shrink-0"
                            onClick={() => removeExpense(session.session_key, exp.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {(form.cash || form.mobile) && (() => {
                      if (isBalanced) {
                        return (
                          <div className="rounded-lg p-2 flex items-center gap-2 text-xs bg-green-50 text-green-700">
                            <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                            All amounts match — balanced!
                          </div>
                        );
                      }
                      const parts: string[] = [];
                      if (form.cash) {
                        if (cashVariance > 0) parts.push(`Cash surplus: +${formatCurrency(cashVariance)}`);
                        else if (cashVariance < 0) parts.push(`Cash shortfall: ${formatCurrency(cashVariance)}`);
                      }
                      if (form.mobile) {
                        if (mobileVariance > 0) parts.push(`Mobile surplus: +${formatCurrency(mobileVariance)}`);
                        else if (mobileVariance < 0) parts.push(`Mobile shortfall: ${formatCurrency(mobileVariance)}`);
                      }
                      const hasShortfall = cashVariance < 0 || mobileVariance < 0;
                      const hasSurplus = cashVariance > 0 || mobileVariance > 0;
                      const bgColor = hasShortfall && hasSurplus
                        ? "bg-amber-50 text-amber-700"
                        : hasShortfall ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700";
                      return (
                        <div className={`rounded-lg p-2 flex items-start gap-2 text-xs ${bgColor}`}>
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>{parts.join(" · ")}</span>
                        </div>
                      );
                    })()}

                    <Button
                      onClick={() => handleSubmit(session)}
                      className="w-full h-8 text-sm"
                      disabled={isSaving}
                    >
                      {isSaving ? "Submitting..." : existing ? "Update" : "Submit"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* ── Right: History table ── */}
        <div>
          <h2 className="font-semibold mb-3">Reconciliation History</h2>
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-3 font-medium text-slate-600">Date</th>
                  <th className="text-center p-3 font-medium text-slate-600">Sessions</th>
                  <th className="text-right p-3 font-medium text-slate-600">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedDates.map((date) => {
                  const dayData = days.find((d) => d.date === date);
                  const isToday = date === today;
                  const isSelected = date === selectedDate;
                  const { label, color } = getDayStatus(date);
                  const sessionCount = dayData?.sessions.length ?? 0;

                  return (
                    <tr
                      key={date}
                      className={`cursor-pointer hover:bg-slate-50 ${isSelected ? "bg-blue-50" : ""}`}
                      onClick={() => setSelectedDate(date)}
                    >
                      <td className="p-3">
                        <span className="font-medium">{formatDate(date)}</span>
                        {isToday && <Badge variant="secondary" className="ml-2 text-xs">Today</Badge>}
                      </td>
                      <td className="p-3 text-center text-slate-500 text-xs">{sessionCount}</td>
                      <td className={`p-3 text-right text-xs ${color}`}>{label}</td>
                      <td className="p-3 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedDates.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-400">No activity for this period</div>
            )}
            {/* Pagination */}
            <div className="flex items-center justify-between px-3 py-2 border-t text-sm">
              <button
                disabled={page === 0}
                onClick={() => router.push(`?page=${page - 1}`)}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-4 w-4" /> Newer
              </button>
              <span className="text-xs text-slate-400">Page {page + 1}</span>
              <button
                disabled={!hasMore}
                onClick={() => router.push(`?page=${page + 1}`)}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                Older <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
