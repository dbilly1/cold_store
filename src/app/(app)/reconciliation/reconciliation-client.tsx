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
import { CheckCircle, AlertTriangle, Calculator } from "lucide-react";

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
  systemCash, systemMobile, existing, history: initial, today,
}: {
  systemCash: number;
  systemMobile: number;
  existing: Reconciliation | null;
  history: Reconciliation[];
  today: string;
}) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [history, setHistory] = useState<Reconciliation[]>(initial);
  const [actualCash, setActualCash] = useState(existing?.actual_cash_entered.toString() ?? "");
  const [actualMobile, setActualMobile] = useState(existing?.actual_mobile_entered.toString() ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(!!existing);

  const cashVariance = (parseFloat(actualCash) || 0) - systemCash;
  const mobileVariance = (parseFloat(actualMobile) || 0) - systemMobile;
  const isBalanced = cashVariance === 0 && mobileVariance === 0;

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
        reconciliation_date: today,
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
        message: `Cash variance: ${formatCurrency(cashV)}, Mobile variance: ${formatCurrency(mobileV)}`,
        related_entity_type: "daily_reconciliations", related_entity_id: data.id,
      });
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id, action: "SUBMIT_RECONCILIATION", entity_type: "daily_reconciliations",
      entity_id: data.id, new_value: { cash_variance: cashV, mobile_variance: mobileV, status },
    });

    setHistory([data as Reconciliation, ...history.filter(h => h.reconciliation_date !== today)]);
    setSubmitted(true);
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

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Reconciliation */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Calculator className="h-4 w-4 text-blue-500" />
                Today&apos;s Reconciliation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* System totals */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium text-slate-600 mb-2">System Totals</p>
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
                    disabled={submitted}
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
                    disabled={submitted}
                  />
                  {actualMobile && (
                    <p className={`text-xs font-medium ${mobileVariance === 0 ? "text-green-600" : "text-red-600"}`}>
                      Variance: {mobileVariance > 0 ? "+" : ""}{formatCurrency(mobileVariance)}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Notes</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitted} placeholder="Optional explanation..." />
                </div>
              </div>

              {/* Result preview */}
              {(actualCash || actualMobile) && (
                <div className={`rounded-lg p-3 flex items-center gap-2 ${isBalanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                  {isBalanced
                    ? <CheckCircle className="h-4 w-4 flex-shrink-0" />
                    : <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  }
                  <p className="text-sm font-medium">
                    {isBalanced ? "All amounts match — balanced!" : "Discrepancy detected — will be flagged"}
                  </p>
                </div>
              )}

              {!submitted ? (
                <Button onClick={handleSubmit} className="w-full" disabled={saving}>
                  {saving ? "Submitting..." : "Submit Reconciliation"}
                </Button>
              ) : (
                <div className="flex items-center gap-2 text-green-600 text-sm justify-center">
                  <CheckCircle className="h-4 w-4" />
                  Reconciliation submitted for today
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* History */}
        <div>
          <h3 className="font-semibold mb-3 text-slate-700">Recent History</h3>
          <div className="space-y-2">
            {history.map((rec) => (
              <Card key={rec.id} className={rec.status === "flagged" ? "border-red-200" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm">{formatDate(rec.reconciliation_date)}</p>
                      <p className="text-xs text-muted-foreground">
                        by {(rec.submitted_by_profile as { full_name: string } | null)?.full_name}
                      </p>
                    </div>
                    {statusBadge(rec.status)}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Cash Variance: </span>
                      <span className={rec.cash_variance !== 0 ? "text-red-600 font-semibold" : "text-green-600"}>
                        {rec.cash_variance > 0 ? "+" : ""}{formatCurrency(rec.cash_variance)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Mobile Variance: </span>
                      <span className={rec.mobile_variance !== 0 ? "text-red-600 font-semibold" : "text-green-600"}>
                        {rec.mobile_variance > 0 ? "+" : ""}{formatCurrency(rec.mobile_variance)}
                      </span>
                    </div>
                  </div>
                  {rec.notes && <p className="text-xs text-slate-500 mt-1 italic">{rec.notes}</p>}
                </CardContent>
              </Card>
            ))}
            {history.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No reconciliation history</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
