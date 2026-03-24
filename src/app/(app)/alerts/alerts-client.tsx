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
import { AlertTriangle, CheckCircle, Bell, X } from "lucide-react";
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

  const filtered = alerts.filter(a => filter === "all" || a.status === filter);
  const openCount = alerts.filter(a => a.status === "open").length;

  async function acknowledge(id: string) {
    const supabase = createClient();
    await supabase.from("alerts").update({
      status: "acknowledged",
      acknowledged_by: profile!.id,
      acknowledged_at: new Date().toISOString(),
    }).eq("id", id);
    setAlerts(alerts.map(a => a.id === id ? { ...a, status: "acknowledged" } : a));
    toast({ title: "Alert acknowledged" });
  }

  async function resolve(id: string) {
    const supabase = createClient();
    await supabase.from("alerts").update({ status: "resolved" }).eq("id", id);
    setAlerts(alerts.map(a => a.id === id ? { ...a, status: "resolved" } : a));
    toast({ title: "Alert resolved" });
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-500" />
          <span className="font-semibold">{openCount} open alert{openCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex gap-1 ml-auto">
          {(["open", "acknowledged", "resolved", "all"] as const).map((s) => (
            <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)} className="capitalize h-8">
              {s}
            </Button>
          ))}
        </div>
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
                      <span className="text-xs text-blue-600">Acknowledged</span>
                    )}
                  </div>
                  <p className="font-medium text-sm">{alert.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{alert.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatDateTime(alert.created_at)}</p>
                </div>
                {alert.status === "open" && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => acknowledge(alert.id)}>
                      Acknowledge
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-green-600 hover:text-green-700" onClick={() => resolve(alert.id)}>
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {alert.status === "acknowledged" && (
                  <Button size="sm" variant="ghost" className="h-7 text-green-600 flex-shrink-0" onClick={() => resolve(alert.id)}>
                    <CheckCircle className="h-4 w-4" />
                  </Button>
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
