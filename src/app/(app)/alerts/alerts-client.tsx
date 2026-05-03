"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { ReactElement } from "react";
import { CheckCircle, Bell, CheckCheck } from "lucide-react";
import type { Alert, AlertStatus } from "@/types/database";

const SEVERITY_STYLE: Record<string, string> = {
  high: "border-l-4 border-l-red-500",
  medium: "border-l-4 border-l-amber-500",
  low: "border-l-4 border-l-blue-500",
};

const SEVERITY_BADGE: Record<string, ReactElement> = {
  high: <Badge variant="destructive">High</Badge>,
  medium: <Badge variant="warning">Medium</Badge>,
  low: <Badge variant="secondary">Low</Badge>,
};

const TYPE_LABELS: Record<string, string> = {
  low_stock: "Low Stock",
  cash_mismatch: "Cash Mismatch",
  fraud_indicator: "Fraud Indicator",
  negative_stock: "Negative Stock",
  high_audit_variance: "Audit Variance",
  excessive_adjustments: "Excessive Adjustments",
  unusual_pricing: "Unusual Pricing",
};

export function AlertsClient({ alerts: initial }: { alerts: Alert[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [alerts, setAlerts] = useState<Alert[]>(initial);
  const [filter, setFilter] = useState<AlertStatus | "all">("open");
  const [acknowledgingAll, setAcknowledgingAll] = useState(false);

  const filtered = alerts.filter(a => filter === "all" || a.status === filter);
  const openAlerts = alerts.filter(a => a.status === "open");
  const openCount = openAlerts.length;

  async function acknowledge(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("alerts").update({
      status: "acknowledged",
      acknowledged_by: profile!.id,
      acknowledged_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast({ title: "Failed to acknowledge alert", description: error.message, variant: "destructive" }); return; }
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: "acknowledged" } : a));
    toast({ title: "Alert acknowledged" });
  }

  async function acknowledgeAll() {
    if (openAlerts.length === 0) return;
    setAcknowledgingAll(true);
    const supabase = createClient();
    const now = new Date().toISOString();
    const ids = openAlerts.map(a => a.id);
    const { error } = await supabase.from("alerts").update({
      status: "acknowledged",
      acknowledged_by: profile!.id,
      acknowledged_at: now,
    }).in("id", ids);
    if (error) {
      toast({ title: "Failed to acknowledge alerts", description: error.message, variant: "destructive" });
    } else {
      setAlerts(prev => prev.map(a => ids.includes(a.id) ? { ...a, status: "acknowledged" } : a));
      toast({ title: `${ids.length} alert${ids.length !== 1 ? "s" : ""} acknowledged` });
    }
    setAcknowledgingAll(false);
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-500" />
          <span className="font-semibold">{openCount} open alert{openCount !== 1 ? "s" : ""}</span>
        </div>
        {openCount > 1 && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
            disabled={acknowledgingAll}
            onClick={acknowledgeAll}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {acknowledgingAll ? "Acknowledging..." : `Acknowledge All (${openCount})`}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-5">
        {(["open", "acknowledged", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              filter === s
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            {s === "all" ? "All" : s === "open" ? "Open" : "Acknowledged"}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((alert) => (
          <Card key={alert.id} className={`${SEVERITY_STYLE[alert.severity]} ${alert.status !== "open" ? "opacity-70" : ""}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {SEVERITY_BADGE[alert.severity]}
                    <span className="text-xs text-muted-foreground bg-slate-100 px-2 py-0.5 rounded">
                      {TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
                    </span>
                    {alert.status === "resolved" && (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Resolved
                      </span>
                    )}
                    {alert.status === "acknowledged" && (
                      <span className="text-xs text-blue-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Acknowledged
                      </span>
                    )}
                  </div>
                  <p className="font-medium text-sm">{alert.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{alert.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatDateTime(alert.created_at)}</p>
                </div>
                {alert.status === "open" && (
                  <button
                    title="Acknowledge"
                    className="text-slate-300 hover:text-green-500 transition-colors flex-shrink-0"
                    onClick={() => acknowledge(alert.id)}
                  >
                    <CheckCircle className="h-5 w-5" />
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-300" />
            <p>No {filter === "all" ? "" : filter} alerts</p>
          </div>
        )}
      </div>
    </div>
  );
}
