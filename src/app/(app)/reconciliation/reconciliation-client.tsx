"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CheckCircle, AlertTriangle, Calculator, ChevronRight, User } from "lucide-react";
import type { DayRecorderData, RecorderSales } from "./page";

interface Reconciliation {
  id: string;
  reconciliation_date: string;
  recorded_by: string | null;
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

export function ReconciliationClient({
  today,
  days,
  reconciliations: initialRecons,
}: {
  today: string;
  days: DayRecorderData[];
  reconciliations: Reconciliation[];
}) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>(initialRecons);
  const [selectedDate, setSelectedDate] = useState(today);
  const [formState, setFormState] = useState<Record<string, FormEntry>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Populate form from existing reconciliations when date changes
  useEffect(() => {
    const dateRecords = reconciliations.filter((r) => r.reconciliation_date === selectedDate);
    const initial: Record<string, FormEntry> = {};
    dateRecords.forEach((r) => {
      if (r.recorded_by) {
        initial[r.recorded_by] = {
          cash: r.actual_cash_entered?.toString() ?? "",
          mobile: r.actual_mobile_entered?.toString() ?? "",
          notes: r.notes ?? "",
        };
      }
    });
    setFormState(initial);
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedDay = days.find((d) => d.date === selectedDate);

  function updateForm(recorderId: string, patch: Partial<FormEntry>) {
    setFormState((prev) => ({
      ...prev,
      [recorderId]: { ...prev[recorderId] ?? { cash: "", mobile: "", notes: "" }, ...patch },
    }));
  }

  // Build lookup: "date|recorder_id" → reconciliation
  const reconLookup = new Map<string, Reconciliation>();
  reconciliations.forEach((r) => {
    if (r.recorded_by) reconLookup.set(`${r.reconciliation_date}|${r.recorded_by}`, r);
  });

  async function handleSubmit(recorderId: string, rec: RecorderSales) {
    const form = formState[recorderId] ?? { cash: "", mobile: "", notes: "" };
    if (!form.cash && !form.mobile) {
      toast({ title: "Enter actual amounts", variant: "destructive" });
      return;
    }
    setSaving((prev) => ({ ...prev, [recorderId]: true }));
    const supabase = createClient();
    const cash = parseFloat(form.cash) || 0;
    const mobile = parseFloat(form.mobile) || 0;
    const expectedCash = rec.system_cash - rec.cash_expenses;
    const cashV = cash - expectedCash;
    const mobileV = mobile - rec.system_mobile;
    const status = cashV === 0 && mobileV === 0 ? "balanced" : "flagged";

    const { data, error } = await supabase
      .from("daily_reconciliations")
      .upsert(
        {
          reconciliation_date: selectedDate,
          submitted_by: profile!.id,
          recorded_by: recorderId,
          system_cash_total: expectedCash,
          system_mobile_total: rec.system_mobile,
          actual_cash_entered: cash,
          actual_mobile_entered: mobile,
          cash_variance: cashV,
          mobile_variance: mobileV,
          status,
          notes: form.notes || null,
        },
        { onConflict: "reconciliation_date,recorded_by" },
      )
      .select(`*, submitted_by_profile:profiles!daily_reconciliations_submitted_by_fkey(full_name)`)
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving((prev) => ({ ...prev, [recorderId]: false }));
      return;
    }

    if (status === "flagged") {
      await supabase.from("alerts").insert({
        alert_type: "cash_mismatch",
        severity: "high",
        title: "Cash Reconciliation Mismatch",
        message: `${formatDate(selectedDate)} — ${rec.recorder_name} — Cash: ${formatCurrency(cashV)}, Mobile: ${formatCurrency(mobileV)}`,
        related_entity_type: "daily_reconciliations",
        related_entity_id: data.id,
      });
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "SUBMIT_RECONCILIATION",
      entity_type: "daily_reconciliations",
      entity_id: data.id,
      new_value: { date: selectedDate, recorder: rec.recorder_name, cash_variance: cashV, mobile_variance: mobileV, status },
    });

    setReconciliations((prev) => [
      data as Reconciliation,
      ...prev.filter((r) => !(r.reconciliation_date === selectedDate && r.recorded_by === recorderId)),
    ]);

    toast({
      title: status === "balanced" ? "Balanced!" : "Mismatch flagged",
      description: status !== "balanced" ? `${rec.recorder_name} will need to explain the discrepancy.` : undefined,
      variant: status === "balanced" ? ("success" as never) : "destructive",
    });
    setSaving((prev) => ({ ...prev, [recorderId]: false }));
  }

  // Build right-panel date list
  const allDates = new Set<string>();
  days.forEach((d) => allDates.add(d.date));
  reconciliations.forEach((r) => allDates.add(r.reconciliation_date));
  const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));

  function getDayStatus(date: string): { label: string; color: string } {
    const dayData = days.find((d) => d.date === date);
    const recorders = dayData?.recorders ?? [];
    if (recorders.length === 0) return { label: "No sales", color: "text-slate-400" };
    const recons = recorders
      .map((r) => reconLookup.get(`${date}|${r.recorder_id}`))
      .filter(Boolean) as Reconciliation[];
    if (recons.length === 0) return { label: "Pending", color: "text-slate-400" };
    if (recons.length < recorders.length)
      return { label: `Partial (${recons.length}/${recorders.length})`, color: "text-amber-600 font-medium" };
    const allBalanced = recons.every((r) => r.status === "balanced");
    return allBalanced
      ? { label: "Balanced", color: "text-green-600 font-medium" }
      : { label: "Mismatch", color: "text-red-600 font-medium" };
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left: Per-recorder forms ── */}
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
                className="h-8 text-sm w-36"
              />
            </div>
          </div>
          {selectedDate !== today && (
            <p className="text-xs text-amber-600 font-medium">Backdated entry for {formatDate(selectedDate)}</p>
          )}

          {!selectedDay || selectedDay.recorders.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-slate-400">
                No sales recorded for {formatDate(selectedDate)}
              </CardContent>
            </Card>
          ) : (
            selectedDay.recorders.map((rec) => {
              const existing = reconLookup.get(`${selectedDate}|${rec.recorder_id}`);
              const form = formState[rec.recorder_id] ?? { cash: "", mobile: "", notes: "" };
              const expectedCash = rec.system_cash - rec.cash_expenses;
              const cashVariance = (parseFloat(form.cash) || 0) - expectedCash;
              const mobileVariance = (parseFloat(form.mobile) || 0) - rec.system_mobile;
              const isBalanced = cashVariance === 0 && mobileVariance === 0;
              const isSaving = saving[rec.recorder_id] ?? false;

              return (
                <Card key={rec.recorder_id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <User className="h-4 w-4 text-slate-400" />
                        {rec.recorder_name}
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
                        <span className="font-medium">{formatCurrency(rec.system_cash)}</span>
                      </div>
                      {rec.cash_expenses > 0 && (
                        <div className="flex justify-between text-amber-700">
                          <span>Till Expenses</span>
                          <span className="font-medium">− {formatCurrency(rec.cash_expenses)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-semibold border-t pt-1.5">
                        <span>Expected Cash</span>
                        <span>{formatCurrency(expectedCash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Mobile Money</span>
                        <span className="font-medium">{formatCurrency(rec.system_mobile)}</span>
                      </div>
                    </div>

                    {/* Actual count inputs */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Actual Cash</Label>
                        <Input
                          type="number" min="0" step="0.01"
                          value={form.cash}
                          onChange={(e) => updateForm(rec.recorder_id, { cash: e.target.value })}
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
                          onChange={(e) => updateForm(rec.recorder_id, { mobile: e.target.value })}
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
                        onChange={(e) => updateForm(rec.recorder_id, { notes: e.target.value })}
                        placeholder="Optional explanation..."
                        className="h-8 text-sm"
                      />
                    </div>

                    {(form.cash || form.mobile) && (
                      <div className={`rounded-lg p-2 flex items-center gap-2 text-xs ${isBalanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                        {isBalanced
                          ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" />
                          : <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />}
                        {isBalanced ? "All amounts match — balanced!" : "Discrepancy detected"}
                      </div>
                    )}

                    <Button
                      onClick={() => handleSubmit(rec.recorder_id, rec)}
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
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-3 font-medium text-slate-600">Date</th>
                  <th className="text-left p-3 font-medium text-slate-600">Recorders</th>
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
                  const recorderNames = dayData?.recorders.map((r) => r.recorder_name).join(", ") ?? "—";

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
                      <td className="p-3 text-xs text-slate-500 max-w-[160px] truncate">{recorderNames}</td>
                      <td className={`p-3 text-right text-xs ${color}`}>{label}</td>
                      <td className="p-3 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedDates.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-400">No activity in the last 30 days</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
