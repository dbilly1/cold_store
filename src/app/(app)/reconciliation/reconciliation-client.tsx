"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { CheckCircle, AlertTriangle, Calculator, Minus } from "lucide-react";
import type { DayWithSales } from "./page";

interface Reconciliation {
  id: string;
  reconciliation_date: string;
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

export function ReconciliationClient({
  today,
  daysWithSales,
  reconciliations: initialRecons,
}: {
  today: string;
  daysWithSales: DayWithSales[];
  reconciliations: Reconciliation[];
}) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>(initialRecons);
  const [selectedDate, setSelectedDate] = useState(today);
  const [saving, setSaving] = useState(false);

  // Form state for selected date
  const [actualCash, setActualCash] = useState("");
  const [actualMobile, setActualMobile] = useState("");
  const [notes, setNotes] = useState("");

  // Derive current values from selected date
  const dayData = daysWithSales.find((d) => d.date === selectedDate);
  const systemCash = dayData?.system_cash ?? 0;
  const systemMobile = dayData?.system_mobile ?? 0;
  const existing = reconciliations.find((r) => r.reconciliation_date === selectedDate);

  // When switching dates, populate form from existing reconciliation
  function selectDate(date: string) {
    setSelectedDate(date);
    const rec = reconciliations.find((r) => r.reconciliation_date === date);
    setActualCash(rec?.actual_cash_entered?.toString() ?? "");
    setActualMobile(rec?.actual_mobile_entered?.toString() ?? "");
    setNotes(rec?.notes ?? "");
  }

  const cashVariance = (parseFloat(actualCash) || 0) - systemCash;
  const mobileVariance = (parseFloat(actualMobile) || 0) - systemMobile;
  const isBalanced = cashVariance === 0 && mobileVariance === 0;
  const isSubmitted = !!existing && !actualCash && !actualMobile
    ? true
    : existing?.actual_cash_entered?.toString() === actualCash &&
      existing?.actual_mobile_entered?.toString() === actualMobile;

  async function handleSubmit() {
    if (!actualCash && !actualMobile) {
      toast({ title: "Enter actual amounts", variant: "destructive" });
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const cash = parseFloat(actualCash) || 0;
    const mobile = parseFloat(actualMobile) || 0;
    const cashV = cash - systemCash;
    const mobileV = mobile - systemMobile;
    const status = cashV === 0 && mobileV === 0 ? "balanced" : "flagged";

    const { data, error } = await supabase
      .from("daily_reconciliations")
      .upsert({
        reconciliation_date: selectedDate,
        submitted_by: profile!.id,
        system_cash_total: systemCash,
        system_mobile_total: systemMobile,
        actual_cash_entered: cash,
        actual_mobile_entered: mobile,
        status,
        notes: notes || null,
      }, { onConflict: "reconciliation_date" })
      .select(`*, submitted_by_profile:profiles!daily_reconciliations_submitted_by_fkey(full_name)`)
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    if (status === "flagged") {
      await supabase.from("alerts").insert({
        alert_type: "cash_mismatch", severity: "high",
        title: "Cash Reconciliation Mismatch",
        message: `${formatDate(selectedDate)} — Cash variance: ${formatCurrency(cashV)}, Mobile: ${formatCurrency(mobileV)}`,
        related_entity_type: "daily_reconciliations", related_entity_id: data.id,
      });
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id, action: "SUBMIT_RECONCILIATION",
      entity_type: "daily_reconciliations", entity_id: data.id,
      new_value: { date: selectedDate, cash_variance: cashV, mobile_variance: mobileV, status },
    });

    setReconciliations([
      data as Reconciliation,
      ...reconciliations.filter(r => r.reconciliation_date !== selectedDate),
    ]);

    toast({
      title: status === "balanced" ? "Balanced! All clear." : "Mismatch flagged — supervisor notified.",
      variant: status === "balanced" ? "success" as never : "destructive",
    });
    setSaving(false);
  }

  const statusBadge = (status: string) => {
    if (status === "balanced") return <Badge variant="success">Balanced</Badge>;
    if (status === "flagged") return <Badge variant="destructive">Mismatch</Badge>;
    return <Badge variant="secondary">Pending</Badge>;
  };

  // Build the right-panel list: all days with sales + reconciliation status
  const reconMap = new Map(reconciliations.map((r) => [r.reconciliation_date, r]));
  const allDays = [...daysWithSales];
  // Add days that have reconciliations but no sales records in daysWithSales
  reconciliations.forEach((r) => {
    if (!allDays.find((d) => d.date === r.reconciliation_date)) {
      allDays.push({ date: r.reconciliation_date, system_cash: r.system_cash_total, system_mobile: r.system_mobile_total });
    }
  });
  allDays.sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left: Reconciliation Form ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-blue-500" />
                  Reconcile a Day
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Date</Label>
                  <Input
                    type="date"
                    value={selectedDate}
                    max={today}
                    onChange={(e) => selectDate(e.target.value)}
                    className="h-8 text-sm w-36"
                  />
                </div>
              </div>
              {selectedDate !== today && (
                <p className="text-xs text-amber-600 font-medium">Backdated entry for {formatDate(selectedDate)}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">

              {/* System totals */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium text-slate-600 mb-2">System Totals for {formatDate(selectedDate)}</p>
                {systemCash === 0 && systemMobile === 0 ? (
                  <p className="text-sm text-slate-400">No sales recorded for this date</p>
                ) : (
                  <>
                    <div className="flex justify-between text-sm">
                      <span>Cash Sales</span>
                      <span className="font-semibold">{formatCurrency(systemCash)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Mobile Money</span>
                      <span className="font-semibold">{formatCurrency(systemMobile)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t pt-2">
                      <span>Total</span>
                      <span>{formatCurrency(systemCash + systemMobile)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Actual entry */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-600">Actual Count</p>
                <div className="space-y-2">
                  <Label>Actual Cash</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    placeholder="0.00"
                  />
                  {actualCash && (
                    <p className={`text-xs font-medium ${cashVariance === 0 ? "text-green-600" : "text-red-600"}`}>
                      Variance: {cashVariance > 0 ? "+" : ""}{formatCurrency(cashVariance)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Actual Mobile Money</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={actualMobile}
                    onChange={(e) => setActualMobile(e.target.value)}
                    placeholder="0.00"
                  />
                  {actualMobile && (
                    <p className={`text-xs font-medium ${mobileVariance === 0 ? "text-green-600" : "text-red-600"}`}>
                      Variance: {mobileVariance > 0 ? "+" : ""}{formatCurrency(mobileVariance)}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional explanation..." />
                </div>
              </div>

              {/* Live balance indicator */}
              {(actualCash || actualMobile) && (
                <div className={`rounded-lg p-3 flex items-center gap-2 ${isBalanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                  {isBalanced
                    ? <CheckCircle className="h-4 w-4 flex-shrink-0" />
                    : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
                  <p className="text-sm font-medium">
                    {isBalanced ? "All amounts match — balanced!" : "Discrepancy detected — will be flagged"}
                  </p>
                </div>
              )}

              <Button onClick={handleSubmit} className="w-full" disabled={saving}>
                {saving ? "Submitting..." : existing ? "Update Reconciliation" : "Submit Reconciliation"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: All days status list ── */}
        <div>
          <h3 className="font-semibold mb-3 text-slate-700">Reconciliation Status — Last 30 Days</h3>
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Date</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Cash</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Mobile</th>
                  <th className="text-center px-4 py-2 font-medium text-slate-500 text-xs">Status</th>
                  <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allDays.map((day) => {
                  const rec = reconMap.get(day.date);
                  const isSelected = day.date === selectedDate;
                  const totalVar = (rec?.cash_variance ?? 0) + (rec?.mobile_variance ?? 0);

                  return (
                    <tr
                      key={day.date}
                      className={`cursor-pointer hover:bg-slate-50 ${isSelected ? "bg-blue-50 hover:bg-blue-50" : ""}`}
                      onClick={() => selectDate(day.date)}
                    >
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${isSelected ? "text-blue-700" : ""}`}>
                          {formatDate(day.date)}
                        </span>
                        {day.date === today && (
                          <Badge variant="secondary" className="ml-2 text-xs">Today</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-600">
                        {formatCurrency(day.system_cash)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-600">
                        {formatCurrency(day.system_mobile)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {!rec ? (
                          <span className="text-xs text-slate-400">Pending</span>
                        ) : (
                          statusBadge(rec.status)
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {rec ? (
                          <span className={totalVar === 0 ? "text-green-600" : totalVar > 0 ? "text-blue-600" : "text-red-600"}>
                            {totalVar === 0
                              ? <Minus className="h-3 w-3 inline" />
                              : totalVar > 0 ? `+${formatCurrency(totalVar)}` : formatCurrency(totalVar)}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {allDays.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No sales data in the last 30 days
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
