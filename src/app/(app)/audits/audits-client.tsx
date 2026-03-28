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
import { formatDate } from "@/lib/utils";
import { Plus, ClipboardList, CheckCircle, ChevronLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { AuditType } from "@/types/database";

interface Product {
  id: string; name: string; unit_type: string;
  current_stock_kg: number; current_stock_units: number; current_stock_boxes: number;
  units_per_box: number | null;
  variance_threshold_pct: number;
}

interface AuditItem {
  id: string; product_id: string;
  system_stock_kg: number; system_stock_units: number; system_stock_boxes: number;
  physical_stock_kg: number; physical_stock_units: number; physical_stock_boxes: number;
  variance_kg: number; variance_units: number; variance_pct: number;
  within_threshold: boolean; notes: string | null;
  product: { name: string; unit_type: string; units_per_box?: number | null } | null;
}

interface Audit {
  id: string; audit_type: string; audit_date: string; status: string;
  notes: string | null; completed_at: string | null; created_at: string;
  conducted_by_profile: { full_name: string } | null;
  items: AuditItem[];
}

type Counts = Record<string, { primary: string; boxes: string }>;

// ---------- helpers ----------
function systemDisplay(item: AuditItem) {
  const ut = item.product?.unit_type;
  // current_stock_kg / current_stock_units already include boxes converted —
  // don't add boxes again or it appears double-counted
  if (ut === "kg")    return `${Number(item.system_stock_kg).toFixed(3)} kg`;
  if (ut === "units") return `${item.system_stock_units} units`;
  return `${item.system_stock_boxes} boxes`;
}

function liveVariance(item: AuditItem, counts: Counts) {
  const c = counts[item.product_id] ?? { primary: "", boxes: "" };
  const physPrimary = parseFloat(c.primary) || 0;
  const physBoxes  = parseFloat(c.boxes)   || 0;
  const ut = item.product?.unit_type;
  const unitsPerBox = item.product?.units_per_box ?? 0;
  const sysPrimary = ut === "kg" ? item.system_stock_kg : ut === "units" ? item.system_stock_units : item.system_stock_boxes;
  // For kg/units: add boxes × units_per_box to the direct primary count
  const effectivePhys = ut === "boxes" ? physBoxes : physPrimary + physBoxes * unitsPerBox;
  const diff = effectivePhys - sysPrimary;
  const pct = sysPrimary > 0 ? Math.abs(diff / sysPrimary) * 100 : 0;
  return { diff, pct, effectivePhys };
}

export function AuditsClient({ products, audits: initial }: { products: Product[]; audits: Audit[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [audits, setAudits] = useState<Audit[]>(initial);
  const [activeAudit, setActiveAudit] = useState<Audit | null>(null);
  const [auditType, setAuditType] = useState<AuditType>("full");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [physicalCounts, setPhysicalCounts] = useState<Counts>({});
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---------- Start Audit ----------
  async function startAudit() {
    setCreating(true);
    const supabase = createClient();
    const auditProducts = auditType === "full"
      ? products
      : products.filter(p => selectedProducts.includes(p.id));

    if (auditProducts.length === 0) {
      toast({ title: "Select at least one product", variant: "destructive" });
      setCreating(false);
      return;
    }

    const { data: audit, error } = await supabase
      .from("stock_audits")
      .insert({ audit_type: auditType, conducted_by: profile!.id, status: "in_progress" })
      .select().single();

    if (error || !audit) {
      toast({ title: "Error", description: error?.message, variant: "destructive" });
      setCreating(false);
      return;
    }

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

    const counts: Counts = {};
    auditProducts.forEach((p) => { counts[p.id] = { primary: "", boxes: "" }; });
    setPhysicalCounts(counts);

    const newAudit: Audit = {
      ...audit,
      conducted_by_profile: { full_name: profile!.full_name },
      items: items.map((item, i) => ({
        ...item, id: "temp_" + i,
        variance_kg: 0, variance_units: 0, variance_pct: 0, within_threshold: true, notes: null,
        product: {
          name: auditProducts[i].name,
          unit_type: auditProducts[i].unit_type,
          units_per_box: auditProducts[i].units_per_box,
        },
      })),
    };

    setAudits([newAudit, ...audits]);
    setActiveAudit(newAudit);
    setCreating(false);
    toast({ title: `Audit started — count ${auditProducts.length} product${auditProducts.length > 1 ? "s" : ""}` });
  }

  // ---------- Complete Audit ----------
  async function completeAudit() {
    if (!activeAudit) return;
    setSaving(true);
    const supabase = createClient();

    const updates = activeAudit.items.map((item) => {
      const p = products.find((prod) => prod.id === item.product_id);
      const counts = physicalCounts[item.product_id] ?? { primary: "0", boxes: "0" };
      const physPrimary = parseFloat(counts.primary) || 0;
      const physBoxes   = parseFloat(counts.boxes)   || 0;
      const isKg    = p?.unit_type === "kg";
      const isBoxes = p?.unit_type === "boxes";
      const unitsPerBox = p?.units_per_box ?? 0;

      // For kg/units: total physical = direct entry + boxes converted to primary unit
      const effectivePhys = isBoxes ? physBoxes : physPrimary + physBoxes * unitsPerBox;
      const physKg    = isKg    ? effectivePhys : 0;
      const physUnits = (!isKg && !isBoxes) ? effectivePhys : 0;

      const sysPrimary = isKg ? item.system_stock_kg : isBoxes ? item.system_stock_boxes : item.system_stock_units;
      const diff = Math.abs(effectivePhys - sysPrimary);
      const variancePct = sysPrimary > 0 ? (diff / sysPrimary) * 100 : 0;
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
          .update({
            physical_stock_kg: u.physical_stock_kg,
            physical_stock_units: u.physical_stock_units,
            physical_stock_boxes: u.physical_stock_boxes,
            variance_pct: u.variance_pct,
            within_threshold: u.within_threshold,
          })
          .eq("id", u.id);
      }
    }

    await supabase.from("stock_audits")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", activeAudit.id);

    const highVariance = updates.find((u) => !u.within_threshold);
    if (highVariance) {
      await supabase.from("alerts").insert({
        alert_type: "high_audit_variance", severity: "high",
        title: "High Audit Variance Detected",
        message: `Stock audit has items outside variance threshold.`,
        related_entity_type: "stock_audits", related_entity_id: activeAudit.id,
      });
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id, action: "COMPLETE_AUDIT",
      entity_type: "stock_audits", entity_id: activeAudit.id,
    });

    setAudits(audits.map((a) => a.id === activeAudit.id ? { ...a, status: "completed" } : a));
    setActiveAudit(null);
    toast({ title: "Audit completed" });
    setSaving(false);
  }

  const statusBadge = (status: string): JSX.Element => {
    const map: Record<string, JSX.Element> = {
      completed: <Badge variant="success">Completed</Badge>,
      in_progress: <Badge variant="warning">In Progress</Badge>,
      draft: <Badge variant="secondary">Draft</Badge>,
      cancelled: <Badge variant="outline">Cancelled</Badge>,
    };
    return map[status] ?? <Badge>{status}</Badge>;
  };

  // ── Active audit count-entry view (full page) ──
  if (activeAudit) {
    const outOfThreshold = activeAudit.items.filter((item) => {
      const { pct } = liveVariance(item, physicalCounts);
      const p = products.find((prod) => prod.id === item.product_id);
      return pct > (p?.variance_threshold_pct ?? 5) && physicalCounts[item.product_id]?.primary !== "";
    });

    return (
      <div className="flex-1 overflow-y-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setActiveAudit(null); }} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <h2 className="font-semibold text-lg">
                {activeAudit.audit_type === "full" ? "Full" : "Random"} Stock Count
              </h2>
              <p className="text-sm text-muted-foreground">
                Enter what you physically count for each product
              </p>
            </div>
          </div>
          <Button onClick={completeAudit} disabled={saving} className="gap-2">
            <CheckCircle className="h-4 w-4" />
            {saving ? "Saving..." : "Complete Audit"}
          </Button>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-4 mb-5 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <span className="text-blue-700 font-medium">{activeAudit.items.length} products to count</span>
          {outOfThreshold.length > 0 && (
            <span className="flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              {outOfThreshold.length} outside variance threshold
            </span>
          )}
        </div>

        {/* Count table */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium text-slate-600 w-48">Product</th>
                <th className="text-right p-3 font-medium text-slate-600">System Stock</th>
                <th className="p-3 font-medium text-slate-600">Physical Count</th>
                <th className="text-right p-3 font-medium text-slate-600 w-28">Variance</th>
                <th className="text-center p-3 font-medium text-slate-600 w-20">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {activeAudit.items.map((item) => {
                const p = item.product;
                const prod = products.find((prod) => prod.id === item.product_id);
                const counts = physicalCounts[item.product_id] ?? { primary: "", boxes: "" };
                const { diff, pct } = liveVariance(item, physicalCounts);
                const hasCount = counts.primary !== "" || counts.boxes !== "";
                const isOver = pct > (prod?.variance_threshold_pct ?? 5);
                const unitLabel = p?.unit_type === "kg" ? "kg" : p?.unit_type === "units" ? "units" : "boxes";

                return (
                  <tr key={item.product_id} className={hasCount && isOver ? "bg-red-50" : hasCount ? "bg-green-50/40" : ""}>
                    {/* Product name */}
                    <td className="p-3">
                      <p className="font-medium">{p?.name}</p>
                      <p className="text-xs text-slate-400 capitalize">{p?.unit_type}</p>
                    </td>

                    {/* System stock */}
                    <td className="p-3 text-right text-slate-600 font-mono text-xs">
                      {systemDisplay(item)}
                    </td>

                    {/* Physical count inputs */}
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {/* Primary quantity (kg or units) — not shown for "boxes" type */}
                        {p?.unit_type !== "boxes" && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number" min="0"
                              step={p?.unit_type === "kg" ? "0.001" : "1"}
                              className="w-28 h-8 text-sm"
                              placeholder={p?.unit_type === "kg" ? "0.000" : "0"}
                              value={counts.primary}
                              onChange={(e) => setPhysicalCounts({
                                ...physicalCounts,
                                [item.product_id]: { ...counts, primary: e.target.value },
                              })}
                            />
                            <Label className="text-xs text-slate-500 whitespace-nowrap">{unitLabel}</Label>
                          </div>
                        )}

                        {/* Boxes input — for "boxes" type it IS the primary count;
                            for kg/units it's an optional conversion helper */}
                        {p?.unit_type === "boxes" ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number" min="0" step="1"
                              className="w-24 h-8 text-sm"
                              placeholder="0"
                              value={counts.primary}
                              onChange={(e) => setPhysicalCounts({ ...physicalCounts, [item.product_id]: { ...counts, primary: e.target.value } })}
                            />
                            <Label className="text-xs text-slate-500">boxes</Label>
                          </div>
                        ) : p?.units_per_box ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number" min="0" step="1"
                              className="w-20 h-8 text-sm"
                              placeholder="0"
                              value={counts.boxes}
                              onChange={(e) => setPhysicalCounts({ ...physicalCounts, [item.product_id]: { ...counts, boxes: e.target.value } })}
                            />
                            <Label className="text-xs text-slate-400 whitespace-nowrap">
                              boxes
                              {parseFloat(counts.boxes) > 0 && (
                                <span className="ml-1 text-blue-500">
                                  (+{(parseFloat(counts.boxes) * p.units_per_box).toFixed(p.unit_type === "kg" ? 3 : 0)} {unitLabel})
                                </span>
                              )}
                            </Label>
                          </div>
                        ) : null}
                      </div>
                    </td>

                    {/* Live variance */}
                    <td className="p-3 text-right font-mono text-xs">
                      {hasCount ? (
                        <div className={diff < 0 ? "text-red-600" : diff > 0 ? "text-green-600" : "text-slate-500"}>
                          <div>{diff > 0 ? "+" : ""}{diff.toFixed(p?.unit_type === "kg" ? 3 : 0)} {unitLabel}</div>
                          <div className="text-[11px] opacity-75">{pct.toFixed(1)}%</div>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Status indicator */}
                    <td className="p-3 text-center">
                      {!hasCount ? (
                        <span className="text-xs text-slate-300">pending</span>
                      ) : isOver ? (
                        <span className="flex items-center justify-center gap-1 text-red-600">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span className="text-xs">Over</span>
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-1 text-green-600">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="text-xs">OK</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={completeAudit} disabled={saving} size="lg" className="gap-2">
            <CheckCircle className="h-4 w-4" />
            {saving ? "Saving..." : "Complete Audit"}
          </Button>
        </div>
      </div>
    );
  }

  // ── Default view: start audit + history ──
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Start Audit Panel */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-blue-500" />
                Start New Audit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Audit Type</Label>
                <Select value={auditType} onValueChange={(v) => setAuditType(v as AuditType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full Audit — all products</SelectItem>
                    <SelectItem value="random">Random — selected products</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {auditType === "random" && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Select products to count</Label>
                  <div className="space-y-1 max-h-56 overflow-y-auto border rounded-md p-2">
                    {products.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm py-1 px-1 rounded hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedProducts.includes(p.id)}
                          onChange={(e) => setSelectedProducts(e.target.checked
                            ? [...selectedProducts, p.id]
                            : selectedProducts.filter(id => id !== p.id)
                          )}
                          className="rounded"
                        />
                        <span>{p.name}</span>
                        <span className="ml-auto text-xs text-slate-400 capitalize">{p.unit_type}</span>
                      </label>
                    ))}
                  </div>
                  {selectedProducts.length > 0 && (
                    <p className="text-xs text-slate-500 mt-1">{selectedProducts.length} selected</p>
                  )}
                </div>
              )}

              <Button onClick={startAudit} className="w-full" disabled={creating}>
                <Plus className="h-4 w-4 mr-1" />
                {creating ? "Starting..." : "Start Audit"}
              </Button>
            </CardContent>
          </Card>
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

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-1 text-slate-500">Product</th>
                          <th className="text-right py-1 text-slate-500">System</th>
                          <th className="text-right py-1 text-slate-500">Physical</th>
                          <th className="text-right py-1 text-slate-500">Variance</th>
                          <th className="text-center py-1 text-slate-500">%</th>
                          <th className="text-center py-1 text-slate-500">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {audit.items?.map((item) => {
                          const p = item.product as { name: string; unit_type: string } | null;
                          const isKg = p?.unit_type === "kg";
                          const isBoxes = p?.unit_type === "boxes";
                          const system = isBoxes ? item.system_stock_boxes : isKg ? item.system_stock_kg : item.system_stock_units;
                          const physical = isBoxes ? item.physical_stock_boxes : isKg ? item.physical_stock_kg : item.physical_stock_units;
                          const variance = isBoxes ? (item.physical_stock_boxes - item.system_stock_boxes) : isKg ? item.variance_kg : item.variance_units;
                          const unit = isKg ? " kg" : isBoxes ? " box" : " u";
                          return (
                            <tr key={item.id} className={!item.within_threshold ? "bg-red-50" : ""}>
                              <td className="py-1.5 font-medium">{p?.name}</td>
                              <td className="text-right py-1.5 font-mono">{Number(system).toFixed(isKg ? 3 : 0)}{unit}</td>
                              <td className="text-right py-1.5 font-mono">{Number(physical).toFixed(isKg ? 3 : 0)}{unit}</td>
                              <td className={`text-right py-1.5 font-mono font-medium ${variance < 0 ? "text-red-600" : variance > 0 ? "text-green-600" : ""}`}>
                                {variance > 0 ? "+" : ""}{Number(variance).toFixed(isKg ? 3 : 0)}{unit}
                              </td>
                              <td className={`text-center py-1.5 ${!item.within_threshold ? "text-red-600 font-bold" : "text-slate-500"}`}>
                                {item.variance_pct.toFixed(1)}%
                              </td>
                              <td className="text-center py-1.5">
                                {item.within_threshold
                                  ? <Badge variant="success" className="text-[10px] px-1 py-0">OK</Badge>
                                  : <Badge variant="destructive" className="text-[10px] px-1 py-0">Flag</Badge>
                                }
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
