"use client";

import React, { useState, type JSX } from "react";
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
import {
  Plus, ClipboardList, CheckCircle, ChevronLeft, AlertTriangle,
  CheckCircle2, ChevronDown, ChevronUp, Play, XCircle, Ban,
} from "lucide-react";
import { TablePagination } from "@/components/ui/table-pagination";
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

// ---------- status helpers ----------

type ItemSeverity = "pending" | "matched" | "ok" | "amber" | "red";

function getItemSeverity(pct: number, threshold: number, hasCount: boolean): ItemSeverity {
  if (!hasCount)          return "pending";
  if (pct === 0)          return "matched";
  if (pct <= threshold)   return "ok";
  if (pct <= 15)          return "amber";
  return "red";
}

const SEVERITY_CONFIG: Record<ItemSeverity, {
  label: string; rowBg: string;
  badgeBg: string; badgeText: string;
  icon: string;
}> = {
  pending:  { label: "—",                rowBg: "",               badgeBg: "",              badgeText: "text-slate-300",  icon: "" },
  matched:  { label: "Matched",          rowBg: "bg-green-50/50", badgeBg: "bg-green-100",  badgeText: "text-green-700",  icon: "✓" },
  ok:       { label: "Within Threshold", rowBg: "bg-green-50/30", badgeBg: "bg-blue-100",   badgeText: "text-blue-700",   icon: "✓" },
  amber:    { label: "Flagged",          rowBg: "bg-amber-50",    badgeBg: "bg-amber-100",  badgeText: "text-amber-700",  icon: "⚠" },
  red:      { label: "Flagged",          rowBg: "bg-red-50",      badgeBg: "bg-red-100",    badgeText: "text-red-700",    icon: "⚠" },
};

function auditSummaryPill(items: AuditItem[]) {
  const flagged = items.filter(i => !i.within_threshold).length;
  const ok      = items.length - flagged;
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        ✓ {ok} OK
      </span>
      {flagged > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
          ⚠ {flagged} Flagged
        </span>
      )}
    </div>
  );
}

function systemDisplay(item: AuditItem) {
  const ut = item.product?.unit_type;
  if (ut === "kg")    return `${Number(item.system_stock_kg).toFixed(3)} kg`;
  if (ut === "units") return `${item.system_stock_units} units`;
  return `${item.system_stock_boxes} boxes`;
}

function liveVariance(item: AuditItem, counts: Counts) {
  const c = counts[item.product_id] ?? { primary: "", boxes: "" };
  const physPrimary = parseFloat(c.primary) || 0;
  const physBoxes   = parseFloat(c.boxes)   || 0;
  const ut = item.product?.unit_type;
  const unitsPerBox = item.product?.units_per_box ?? 0;
  const sysPrimary = ut === "kg" ? item.system_stock_kg : ut === "units" ? item.system_stock_units : item.system_stock_boxes;
  const effectivePhys = ut === "boxes" ? physPrimary : physPrimary + physBoxes * unitsPerBox;
  const diff = effectivePhys - sysPrimary;
  const pct = sysPrimary > 0 ? Math.abs(diff / sysPrimary) * 100 : 0;
  return { diff, pct, effectivePhys };
}

// Today's date string (YYYY-MM-DD local)
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AuditsClient({ products, audits: initial }: { products: Product[]; audits: Audit[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [audits, setAudits] = useState<Audit[]>(initial);
  const [activeAudit, setActiveAudit] = useState<Audit | null>(null);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(0);
  const [auditPageSize, setAuditPageSize] = useState(25);
  const [auditType, setAuditType] = useState<AuditType>("full");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [physicalCounts, setPhysicalCounts] = useState<Counts>({});
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── New state for the four features ──
  const [confirmLeave, setConfirmLeave] = useState(false);   // Back confirmation
  const [confirmNewAudit, setConfirmNewAudit] = useState(false); // Duplicate day warning
  const [cancellingId, setCancellingId] = useState<string | null>(null); // Cancel/void in progress
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin" || profile?.role === "supervisor";
  const today = todayStr();

  // ---------- Cancel / Void an audit ----------
  async function cancelAudit(auditId: string) {
    setCancellingId(auditId);
    const supabase = createClient();
    await supabase
      .from("stock_audits")
      .update({ status: "cancelled" })
      .eq("id", auditId);
    await supabase.from("audit_logs").insert({
      user_id: profile!.id, action: "CANCEL_AUDIT",
      entity_type: "stock_audits", entity_id: auditId,
    });
    setAudits(prev => prev.map(a => a.id === auditId ? { ...a, status: "cancelled" } : a));
    setCancellingId(null);
    toast({ title: "Audit cancelled" });
  }

  async function voidAudit(auditId: string) {
    setVoidingId(auditId);
    const supabase = createClient();
    await supabase
      .from("stock_audits")
      .update({ status: "cancelled" })
      .eq("id", auditId);
    await supabase.from("audit_logs").insert({
      user_id: profile!.id, action: "VOID_AUDIT",
      entity_type: "stock_audits", entity_id: auditId,
    });
    setAudits(prev => prev.map(a => a.id === auditId ? { ...a, status: "cancelled" } : a));
    setVoidingId(null);
    toast({ title: "Audit voided" });
  }

  // ---------- Resume an in-progress audit ----------
  function resumeAudit(audit: Audit) {
    const counts: Counts = {};
    audit.items.forEach(item => { counts[item.product_id] = { primary: "", boxes: "" }; });
    setPhysicalCounts(counts);
    setActiveAudit(audit);
    setConfirmLeave(false);
  }

  // ---------- Start Audit (with duplicate check) ----------
  async function doStartAudit() {
    setConfirmNewAudit(false);
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

    const { data: insertedItems } = await supabase
      .from("stock_audit_items")
      .insert(items)
      .select("id, product_id");

    const counts: Counts = {};
    auditProducts.forEach((p) => { counts[p.id] = { primary: "", boxes: "" }; });
    setPhysicalCounts(counts);

    const itemIdMap = Object.fromEntries((insertedItems ?? []).map(r => [r.product_id, r.id]));

    const newAudit: Audit = {
      ...audit,
      conducted_by_profile: { full_name: profile!.full_name },
      items: items.map((item, i) => ({
        ...item,
        id: itemIdMap[item.product_id] ?? "temp_" + i,
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

  function startAudit() {
    // Warn if a completed audit already exists for today
    const hasCompletedToday = audits.some(a => a.status === "completed" && a.audit_date === today);
    if (hasCompletedToday) {
      setConfirmNewAudit(true);
      return;
    }
    doStartAudit();
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

      const effectivePhys = isBoxes ? physPrimary : physPrimary + physBoxes * unitsPerBox;
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
        physical_stock_boxes: isBoxes ? physPrimary : physBoxes,
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
    setConfirmLeave(false);
    toast({ title: "Audit completed" });
    setSaving(false);
  }

  const statusBadge = (status: string): JSX.Element => {
    const map: Record<string, JSX.Element> = {
      completed:   <Badge variant="success">Completed</Badge>,
      in_progress: <Badge variant="warning">In Progress</Badge>,
      draft:       <Badge variant="secondary">Draft</Badge>,
      cancelled:   <Badge variant="outline">Cancelled</Badge>,
    };
    return map[status] ?? <Badge>{status}</Badge>;
  };

  // ── Active audit count-entry view ──
  if (activeAudit) {
    const total   = activeAudit.items.length;
    const counted = activeAudit.items.filter((item) => {
      const c = physicalCounts[item.product_id];
      return c?.primary !== "" || c?.boxes !== "";
    }).length;
    const allDone = counted === total;

    const flaggedAmber = activeAudit.items.filter((item) => {
      const { pct } = liveVariance(item, physicalCounts);
      const threshold = products.find(p => p.id === item.product_id)?.variance_threshold_pct ?? 5;
      const sev = getItemSeverity(pct, threshold, physicalCounts[item.product_id]?.primary !== "" || physicalCounts[item.product_id]?.boxes !== "");
      return sev === "amber";
    }).length;
    const flaggedRed = activeAudit.items.filter((item) => {
      const { pct } = liveVariance(item, physicalCounts);
      const threshold = products.find(p => p.id === item.product_id)?.variance_threshold_pct ?? 5;
      const sev = getItemSeverity(pct, threshold, physicalCounts[item.product_id]?.primary !== "" || physicalCounts[item.product_id]?.boxes !== "");
      return sev === "red";
    }).length;

    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost" size="sm"
              onClick={() => setConfirmLeave(true)}
              className="gap-1"
            >
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

        {/* Leave confirmation banner */}
        {confirmLeave && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800 flex-1 min-w-0">
              Leave this audit? Choose to <strong>keep it in progress</strong> so you can resume later, or <strong>cancel it</strong> to remove it from records.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={() => setConfirmLeave(false)}>
                Stay
              </Button>
              <Button
                size="sm" variant="outline"
                className="text-slate-700"
                onClick={() => { setActiveAudit(null); setConfirmLeave(false); }}
              >
                Keep In Progress
              </Button>
              <Button
                size="sm" variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50"
                disabled={cancellingId === activeAudit.id}
                onClick={async () => {
                  await cancelAudit(activeAudit.id);
                  setActiveAudit(null);
                  setConfirmLeave(false);
                }}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Cancel Audit
              </Button>
            </div>
          </div>
        )}

        {/* Summary bar */}
        <div className={`flex flex-wrap items-center gap-3 mb-5 p-3 rounded-lg border text-sm ${
          flaggedRed > 0 ? "bg-red-50 border-red-200" :
          flaggedAmber > 0 ? "bg-amber-50 border-amber-200" :
          allDone ? "bg-green-50 border-green-200" : "bg-blue-50 border-blue-200"
        }`}>
          <span className={`font-medium ${allDone ? "text-green-700" : "text-blue-700"}`}>
            {counted} / {total} counted
          </span>
          <div className="flex-1 min-w-24 h-1.5 bg-white/70 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${allDone && flaggedRed === 0 && flaggedAmber === 0 ? "bg-green-500" : "bg-blue-500"}`}
              style={{ width: `${total > 0 ? (counted / total) * 100 : 0}%` }}
            />
          </div>
          {flaggedRed > 0 && (
            <span className="flex items-center gap-1 text-red-700 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {flaggedRed} high variance
            </span>
          )}
          {flaggedAmber > 0 && (
            <span className="flex items-center gap-1 text-amber-700 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {flaggedAmber} moderate variance
            </span>
          )}
          {allDone && flaggedRed === 0 && flaggedAmber === 0 && (
            <span className="flex items-center gap-1 text-green-700 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All within threshold
            </span>
          )}
        </div>

        {/* Count table */}
        <div className="bg-white rounded-lg border overflow-x-auto">
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
                const threshold = prod?.variance_threshold_pct ?? 5;
                const severity = getItemSeverity(pct, threshold, hasCount);
                const cfg = SEVERITY_CONFIG[severity];
                const unitLabel = p?.unit_type === "kg" ? "kg" : p?.unit_type === "units" ? "units" : "boxes";

                return (
                  <tr key={item.product_id} className={cfg.rowBg}>
                    <td className="p-3">
                      <p className="font-medium">{p?.name}</p>
                      <p className="text-xs text-slate-400 capitalize">{p?.unit_type}</p>
                    </td>
                    <td className="p-3 text-right text-slate-600 font-mono text-xs">
                      {systemDisplay(item)}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
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
                                  (+{(parseFloat(counts.boxes) * p.units_per_box!).toFixed(p.unit_type === "kg" ? 3 : 0)} {unitLabel})
                                </span>
                              )}
                            </Label>
                          </div>
                        ) : null}
                      </div>
                    </td>
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
                    <td className="p-3 text-center">
                      {severity === "pending" ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badgeBg} ${cfg.badgeText}`}>
                          {cfg.icon && <span>{cfg.icon}</span>}
                          {cfg.label}
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
  const inProgressAudits = audits.filter(a => a.status === "in_progress");
  const historyAudits    = audits.filter(a => a.status === "completed");
  const pagedAudits      = historyAudits.slice(auditPage * auditPageSize, (auditPage + 1) * auditPageSize);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
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
            <CardContent className="space-y-4">
              {/* Duplicate-day warning */}
              {confirmNewAudit && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      A completed audit already exists for <strong>today</strong>. Running a second one will create a duplicate record that may affect loss analysis.
                    </p>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setConfirmNewAudit(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={doStartAudit} disabled={creating}>
                      {creating ? "Starting..." : "Start Anyway"}
                    </Button>
                  </div>
                </div>
              )}

              {!confirmNewAudit && (
                <>
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
                </>
              )}
            </CardContent>
          </Card>

          {/* In-progress audits panel */}
          {inProgressAudits.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  In Progress ({inProgressAudits.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {inProgressAudits.map(audit => (
                  <div
                    key={audit.id}
                    className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-amber-100"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-700 capitalize">{audit.audit_type} audit</p>
                      <p className="text-xs text-slate-400">
                        {formatDate(audit.audit_date)} · {audit.items.length} products
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm" variant="outline"
                        className="h-7 px-2.5 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                        onClick={() => resumeAudit(audit)}
                      >
                        <Play className="h-3 w-3" />
                        Resume
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        className="h-7 px-2.5 text-xs gap-1 text-red-500 border-red-200 hover:bg-red-50"
                        disabled={cancellingId === audit.id}
                        onClick={() => cancelAudit(audit.id)}
                      >
                        <XCircle className="h-3 w-3" />
                        {cancellingId === audit.id ? "…" : "Cancel"}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Audit History */}
        <div className="lg:col-span-2">
          <h3 className="font-semibold mb-3 text-slate-700">Audit History</h3>
          <div className="border rounded-lg overflow-hidden bg-white">
            {historyAudits.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No audits yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left p-3 font-medium text-slate-600">Date</th>
                    <th className="text-left p-3 font-medium text-slate-600">Type</th>
                    <th className="text-left p-3 font-medium text-slate-600">Conducted By</th>
                    <th className="text-left p-3 font-medium text-slate-600">Result</th>
                    <th className="text-left p-3 font-medium text-slate-600">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pagedAudits.map((audit) => {
                    const isExpanded = expandedAuditId === audit.id;
                    const flagged = audit.items.filter(i => !i.within_threshold).length;
                    return (
                      <React.Fragment key={audit.id}>
                        <tr
                          className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpanded ? "bg-slate-50" : ""}`}
                          onClick={() => setExpandedAuditId(isExpanded ? null : audit.id)}
                        >
                          <td className="p-3 font-medium whitespace-nowrap text-slate-800">
                            {formatDate(audit.audit_date)}
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className="capitalize text-xs">{audit.audit_type}</Badge>
                          </td>
                          <td className="p-3 text-slate-500 text-xs">
                            {audit.conducted_by_profile?.full_name ?? "—"}
                          </td>
                          <td className="p-3">
                            {audit.items?.length > 0 && auditSummaryPill(audit.items)}
                          </td>
                          <td className="p-3">
                            {statusBadge(audit.status)}
                          </td>
                          <td className="p-3 text-center">
                            {isExpanded
                              ? <ChevronUp className="h-4 w-4 inline text-slate-400" />
                              : <ChevronDown className="h-4 w-4 inline text-slate-400" />}
                            {/* Void button — admin only */}
                            {isAdmin && (
                              <button
                                title="Void audit"
                                className="ml-1 text-slate-300 hover:text-red-500 transition-colors"
                                disabled={voidingId === audit.id}
                                onClick={(e) => { e.stopPropagation(); voidAudit(audit.id); }}
                              >
                                <Ban className="h-3.5 w-3.5 inline" />
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} className="bg-blue-50/40 px-4 py-4 border-b border-blue-100">
                              {flagged > 0 && (
                                <div className="flex items-center gap-1.5 mb-3 text-xs text-amber-700 font-medium">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {flagged} item{flagged !== 1 ? "s" : ""} outside variance threshold
                                </div>
                              )}
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-blue-100">
                                      <th className="text-left pb-2 font-medium text-slate-500">Product</th>
                                      <th className="text-right pb-2 font-medium text-slate-500 px-3">System</th>
                                      <th className="text-right pb-2 font-medium text-slate-500 px-3">Physical</th>
                                      <th className="text-right pb-2 font-medium text-slate-500 px-3">Variance</th>
                                      <th className="text-center pb-2 font-medium text-slate-500 px-3">%</th>
                                      <th className="text-center pb-2 font-medium text-slate-500">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {audit.items?.map((item) => {
                                      const p = item.product as { name: string; unit_type: string } | null;
                                      const isKg    = p?.unit_type === "kg";
                                      const isBoxes = p?.unit_type === "boxes";
                                      const system   = isBoxes ? item.system_stock_boxes   : isKg ? item.system_stock_kg   : item.system_stock_units;
                                      const physical = isBoxes ? item.physical_stock_boxes : isKg ? item.physical_stock_kg : item.physical_stock_units;
                                      const variance = physical - system;
                                      const unit     = isKg ? " kg" : isBoxes ? " box" : " u";
                                      const hsev: ItemSeverity = item.variance_pct === 0
                                        ? "matched"
                                        : item.within_threshold ? "ok"
                                        : item.variance_pct <= 15 ? "amber"
                                        : "red";
                                      const hcfg = SEVERITY_CONFIG[hsev];
                                      return (
                                        <tr key={item.id} className={`border-b border-blue-50 last:border-0 ${hcfg.rowBg}`}>
                                          <td className="py-2 font-medium text-slate-800">{p?.name}</td>
                                          <td className="py-2 px-3 text-right font-mono text-slate-600">{Number(system).toFixed(isKg ? 3 : 0)}{unit}</td>
                                          <td className="py-2 px-3 text-right font-mono text-slate-600">{Number(physical).toFixed(isKg ? 3 : 0)}{unit}</td>
                                          <td className={`py-2 px-3 text-right font-mono font-medium ${variance < 0 ? "text-red-600" : variance > 0 ? "text-green-600" : "text-slate-500"}`}>
                                            {variance > 0 ? "+" : ""}{Number(variance).toFixed(isKg ? 3 : 0)}{unit}
                                          </td>
                                          <td className={`py-2 px-3 text-center font-medium ${hcfg.badgeText}`}>
                                            {item.variance_pct.toFixed(1)}%
                                          </td>
                                          <td className="py-2 text-center">
                                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${hcfg.badgeBg} ${hcfg.badgeText}`}>
                                              {hcfg.icon} {hcfg.label}
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            {historyAudits.length > 0 && (
              <TablePagination
                total={historyAudits.length}
                page={auditPage}
                pageSize={auditPageSize}
                onPageChange={(p) => { setAuditPage(p); setExpandedAuditId(null); }}
                onPageSizeChange={(s) => { setAuditPageSize(s); setAuditPage(0); setExpandedAuditId(null); }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
