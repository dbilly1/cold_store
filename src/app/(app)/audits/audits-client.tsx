"use client";

import { useState, type JSX } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Plus, ClipboardList, CheckCircle } from "lucide-react";
import type { AuditType } from "@/types/database";

interface Product {
  id: string; name: string; unit_type: string;
  current_stock_kg: number; current_stock_units: number; current_stock_boxes: number;
  variance_threshold_pct: number;
}

interface AuditItem {
  id: string; product_id: string;
  system_stock_kg: number; system_stock_units: number; system_stock_boxes: number;
  physical_stock_kg: number; physical_stock_units: number; physical_stock_boxes: number;
  variance_kg: number; variance_units: number; variance_pct: number;
  within_threshold: boolean; notes: string | null;
  product: { name: string; unit_type: string } | null;
}

interface Audit {
  id: string; audit_type: string; audit_date: string; status: string;
  notes: string | null; completed_at: string | null; created_at: string;
  conducted_by_profile: { full_name: string } | null;
  items: AuditItem[];
}

export function AuditsClient({ products, audits: initial }: { products: Product[]; audits: Audit[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [audits, setAudits] = useState<Audit[]>(initial);
  const [activeAudit, setActiveAudit] = useState<Audit | null>(null);
  const [auditType, setAuditType] = useState<AuditType>("full");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, { kg: string; units: string; boxes: string }>>({});
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  async function startAudit() {
    setCreating(true);
    const supabase = createClient();
    const auditProducts = auditType === "full" ? products : products.filter(p => selectedProducts.includes(p.id));
    if (auditProducts.length === 0) {
      toast({ title: "Select at least one product", variant: "destructive" });
      setCreating(false);
      return;
    }

    const { data: audit, error } = await supabase
      .from("stock_audits")
      .insert({ audit_type: auditType, conducted_by: profile!.id, status: "in_progress" })
      .select()
      .single();

    if (error || !audit) { toast({ title: "Error", description: error?.message, variant: "destructive" }); setCreating(false); return; }

    const items = auditProducts.map((p) => ({
      audit_id: audit.id,
      product_id: p.id,
      system_stock_kg: p.current_stock_kg,
      system_stock_units: p.current_stock_units,
      system_stock_boxes: p.current_stock_boxes,
      physical_stock_kg: 0,
      physical_stock_units: 0,
      physical_stock_boxes: 0,
      variance_pct: 0,
      within_threshold: true,
    }));

    await supabase.from("stock_audit_items").insert(items);

    // Initialize physical counts
    const counts: Record<string, { kg: string; units: string; boxes: string }> = {};
    auditProducts.forEach((p) => {
      counts[p.id] = { kg: "0", units: "0", boxes: "0" };
    });
    setPhysicalCounts(counts);

    const newAudit: Audit = {
      ...audit,
      conducted_by_profile: { full_name: profile!.full_name },
      items: items.map((item, i) => ({
        ...item, id: "temp_" + i,
        variance_kg: 0, variance_units: 0, variance_pct: 0, within_threshold: true, notes: null,
        product: { name: auditProducts[i].name, unit_type: auditProducts[i].unit_type },
      })),
    };
    setAudits([newAudit, ...audits]);
    setActiveAudit(newAudit);
    setCreating(false);
    toast({ title: "Audit started — enter physical counts" });
  }

  async function completeAudit() {
    if (!activeAudit) return;
    setSaving(true);
    const supabase = createClient();

    const updates = activeAudit.items.map((item) => {
      const p = products.find((prod) => prod.id === item.product_id);
      const counts = physicalCounts[item.product_id] ?? { kg: "0", units: "0", boxes: "0" };
      const physKg = parseFloat(counts.kg) || 0;
      const physUnits = parseFloat(counts.units) || 0;
      const physBoxes = parseFloat(counts.boxes) || 0;
      const varKg = physKg - item.system_stock_kg;
      const varUnits = physUnits - item.system_stock_units;
      const primaryVar = Math.abs(p?.unit_type === "kg" ? varKg : varUnits);
      const primarySystem = p?.unit_type === "kg" ? item.system_stock_kg : item.system_stock_units;
      const variancePct = primarySystem > 0 ? (primaryVar / primarySystem) * 100 : 0;
      const withinThreshold = variancePct <= (p?.variance_threshold_pct ?? 5);

      return {
        id: item.id,
        physical_stock_kg: physKg,
        physical_stock_units: physUnits,
        physical_stock_boxes: physBoxes,
        variance_pct: variancePct,
        within_threshold: withinThreshold,
      };
    });

    for (const u of updates) {
      if (!u.id.startsWith("temp_")) {
        await supabase.from("stock_audit_items")
          .update({ physical_stock_kg: u.physical_stock_kg, physical_stock_units: u.physical_stock_units, physical_stock_boxes: u.physical_stock_boxes, variance_pct: u.variance_pct, within_threshold: u.within_threshold })
          .eq("id", u.id);
      }
    }

    await supabase.from("stock_audits")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", activeAudit.id);

    // Alert for high variances
    const highVariance = updates.find((u) => !u.within_threshold);
    if (highVariance) {
      await supabase.from("alerts").insert({
        alert_type: "high_audit_variance", severity: "high",
        title: "High Audit Variance Detected",
        message: `Stock audit ${activeAudit.id} has items outside variance threshold.`,
        related_entity_type: "stock_audits", related_entity_id: activeAudit.id,
      });
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id, action: "COMPLETE_AUDIT", entity_type: "stock_audits", entity_id: activeAudit.id,
    });

    setAudits(audits.map((a) => a.id === activeAudit.id ? { ...a, status: "completed" } : a));
    setActiveAudit(null);
    toast({ title: "Audit completed" });
    setSaving(false);
  }

  const statusBadge = (status: string) => {
    const map: Record<string, JSX.Element> = {
      completed: <Badge variant="success">Completed</Badge>,
      in_progress: <Badge variant="warning">In Progress</Badge>,
      draft: <Badge variant="secondary">Draft</Badge>,
      cancelled: <Badge variant="outline">Cancelled</Badge>,
    };
    return map[status] ?? <Badge>{status}</Badge>;
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Start Audit Panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-blue-500" />
                Start New Audit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Audit Type</Label>
                <Select value={auditType} onValueChange={(v) => setAuditType(v as AuditType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full Audit (all products)</SelectItem>
                    <SelectItem value="random">Random Audit (selected products)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {auditType === "random" && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  <Label className="text-xs text-muted-foreground">Select products</Label>
                  {products.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedProducts.includes(p.id)}
                        onChange={(e) => setSelectedProducts(e.target.checked
                          ? [...selectedProducts, p.id]
                          : selectedProducts.filter(id => id !== p.id)
                        )}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}

              <Button onClick={startAudit} className="w-full" disabled={creating || !!activeAudit}>
                <Plus className="h-4 w-4 mr-1" />
                {creating ? "Starting..." : "Start Audit"}
              </Button>
              {activeAudit && (
                <p className="text-xs text-amber-600 text-center">Complete current audit first</p>
              )}
            </CardContent>
          </Card>

          {/* Active Audit */}
          {activeAudit && (
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-sm text-blue-700">Active Audit — Enter Physical Counts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {activeAudit.items.map((item) => {
                  const p = item.product as { name: string; unit_type: string } | null;
                  const counts = physicalCounts[item.product_id] ?? { kg: "0", units: "0", boxes: "0" };
                  return (
                    <div key={item.product_id} className="border rounded-lg p-2 space-y-1">
                      <p className="text-xs font-medium">{p?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        System: {p?.unit_type === "kg" ? `${item.system_stock_kg} kg` : `${item.system_stock_units} units`}
                      </p>
                      <div className="grid grid-cols-3 gap-1">
                        <Input type="number" className="h-7 text-xs" placeholder="kg"
                          value={counts.kg} onChange={(e) => setPhysicalCounts({ ...physicalCounts, [item.product_id]: { ...counts, kg: e.target.value } })} />
                        <Input type="number" className="h-7 text-xs" placeholder="units"
                          value={counts.units} onChange={(e) => setPhysicalCounts({ ...physicalCounts, [item.product_id]: { ...counts, units: e.target.value } })} />
                        <Input type="number" className="h-7 text-xs" placeholder="boxes"
                          value={counts.boxes} onChange={(e) => setPhysicalCounts({ ...physicalCounts, [item.product_id]: { ...counts, boxes: e.target.value } })} />
                      </div>
                    </div>
                  );
                })}
                <Button onClick={completeAudit} className="w-full mt-2" disabled={saving}>
                  <CheckCircle className="h-4 w-4 mr-1" />
                  {saving ? "Completing..." : "Complete Audit"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Audit History */}
        <div className="lg:col-span-2">
          <h3 className="font-semibold mb-3 text-slate-700">Audit History</h3>
          <div className="space-y-3">
            {audits.filter(a => a.status === "completed").map((audit) => (
              <Card key={audit.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{formatDate(audit.audit_date)}</p>
                        <Badge variant="outline" className="capitalize text-xs">{audit.audit_type}</Badge>
                        {statusBadge(audit.status)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        by {(audit.conducted_by_profile as { full_name: string } | null)?.full_name}
                      </p>
                    </div>
                  </div>

                  {/* Variance table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1 text-slate-500">Product</th>
                          <th className="text-right py-1 text-slate-500">System</th>
                          <th className="text-right py-1 text-slate-500">Physical</th>
                          <th className="text-right py-1 text-slate-500">Variance</th>
                          <th className="text-center py-1 text-slate-500">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.items?.map((item) => {
                          const p = item.product as { name: string; unit_type: string } | null;
                          const isKg = p?.unit_type === "kg";
                          const system = isKg ? item.system_stock_kg : item.system_stock_units;
                          const physical = isKg ? item.physical_stock_kg : item.physical_stock_units;
                          const variance = isKg ? item.variance_kg : item.variance_units;
                          const unit = isKg ? "kg" : "u";
                          return (
                            <tr key={item.id} className={!item.within_threshold ? "bg-red-50" : ""}>
                              <td className="py-1">{p?.name}</td>
                              <td className="text-right py-1">{system}{unit}</td>
                              <td className="text-right py-1">{physical}{unit}</td>
                              <td className={`text-right py-1 font-medium ${variance < 0 ? "text-red-600" : variance > 0 ? "text-green-600" : ""}`}>
                                {variance > 0 ? "+" : ""}{variance.toFixed(3)}{unit}
                              </td>
                              <td className={`text-center py-1 ${!item.within_threshold ? "text-red-600 font-bold" : "text-slate-500"}`}>
                                {item.variance_pct.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
            {audits.filter(a => a.status === "completed").length === 0 && (
              <div className="text-center py-12 text-muted-foreground">No completed audits yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
