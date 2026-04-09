"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import {
  format,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
  parseISO,
} from "date-fns";
import * as XLSX from "xlsx";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  TrendingDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface StockAdditionRow {
  id: string;
  created_at: string;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  cost_price_per_unit: number;
  total_cost: number;
  supplier: string | null;
  notes: string | null;
  product: { id: string; name: string; unit_type: string } | null;
  added_by_profile: { full_name: string } | null;
}

interface StockAuditItemRow {
  id: string;
  product_id: string;
  system_stock_kg: number;
  system_stock_units: number;
  system_stock_boxes: number;
  physical_stock_kg: number;
  physical_stock_units: number;
  physical_stock_boxes: number;
  variance_kg: number;
  variance_units: number;
  variance_boxes: number;
  variance_pct: number;
  within_threshold: boolean;
  notes: string | null;
  product: { id: string; name: string; unit_type: string } | null;
}

interface StockAuditRow {
  id: string;
  created_at: string;
  audit_date: string;
  audit_type: "full" | "random";
  status: "draft" | "in_progress" | "completed" | "cancelled";
  notes: string | null;
  completed_at: string | null;
  conducted_by_profile: { full_name: string } | null;
  items: StockAuditItemRow[];
}

interface StockAdjustmentRow {
  id: string;
  created_at: string;
  quantity_kg_delta: number;
  quantity_units_delta: number;
  quantity_boxes_delta: number;
  reason: string;
  approval_status: string;
  notes: string | null;
  product: { id: string; name: string; unit_type: string } | null;
  created_by_profile: { full_name: string } | null;
  approved_by_profile: { full_name: string } | null;
}

interface ProductWithCost {
  id: string;
  name: string;
  unit_type: string;
  selling_price: number;
}

interface AdjustDialogState {
  open: boolean;
  auditId: string;
  productId: string;
  productName: string;
  unitType: string;
  deltaKg: number;
  deltaUnits: number;
  deltaBoxes: number;
  stockBeforeKg: number;
  stockBeforeUnits: number;
  stockBeforeBoxes: number;
  notes: string;
  saving: boolean;
}

// ── Helpers ────────────────────────────────────────────────────

function primaryQtyLabel(row: StockAdditionRow): string {
  if (!row.product) return "—";
  if (row.product.unit_type === "kg") return `${Number(row.quantity_kg).toFixed(3)} kg`;
  if (row.product.unit_type === "units") return `${Number(row.quantity_units)} units`;
  return `${Number(row.quantity_boxes)} boxes`;
}

function deltaLabel(row: StockAdjustmentRow): { text: string; positive: boolean } {
  if (!row.product) return { text: "—", positive: true };
  let val = 0;
  if (row.product.unit_type === "kg") val = row.quantity_kg_delta ?? 0;
  else if (row.product.unit_type === "units") val = row.quantity_units_delta ?? 0;
  else val = row.quantity_boxes_delta ?? 0;
  const unit = row.product.unit_type;
  return {
    text: `${val >= 0 ? "+" : ""}${val} ${unit}`,
    positive: val >= 0,
  };
}

function statusBadge(status: string) {
  const base = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium";
  if (status === "approved")   return <span className={`${base} bg-green-100 text-green-700`}>Approved</span>;
  if (status === "rejected")   return <span className={`${base} bg-red-100 text-red-700`}>Rejected</span>;
  if (status === "completed")  return <span className={`${base} bg-green-100 text-green-700`}>Completed</span>;
  if (status === "cancelled")  return <span className={`${base} bg-red-100 text-red-700`}>Cancelled</span>;
  if (status === "in_progress") return <span className={`${base} bg-blue-100 text-blue-700`}>In Progress</span>;
  return <span className={`${base} bg-amber-100 text-amber-700`}>Draft</span>;
}

function auditTypeBadge(type: string) {
  const base = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium";
  if (type === "full") return <span className={`${base} bg-purple-100 text-purple-700`}>Full</span>;
  return <span className={`${base} bg-slate-100 text-slate-700`}>Random</span>;
}

function getVariance(item: StockAuditItemRow): { sys: number; phy: number; delta: number; unit: string } {
  const ut = item.product?.unit_type ?? "kg";
  const sys = ut === "kg" ? item.system_stock_kg : ut === "units" ? item.system_stock_units : item.system_stock_boxes;
  const phy = ut === "kg" ? item.physical_stock_kg : ut === "units" ? item.physical_stock_units : item.physical_stock_boxes;
  return { sys, phy, delta: phy - sys, unit: ut };
}

// ── Component ──────────────────────────────────────────────────

export function InventoryHistoryClient() {
  const { toast } = useToast();
  const { profile } = useProfile();
  const today = format(new Date(), "yyyy-MM-dd");

  const [activeSubTab, setActiveSubTab] = useState<"restocks" | "adjustments" | "audits" | "loss">("restocks");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [activePreset, setActivePreset] = useState("today");

  const [loadingRestocks, setLoadingRestocks] = useState(true);
  const [loadingAdjustments, setLoadingAdjustments] = useState(true);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [restocks, setRestocks] = useState<StockAdditionRow[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustmentRow[]>([]);
  const [audits, setAudits] = useState<StockAuditRow[]>([]);
  const [products, setProducts] = useState<ProductWithCost[]>([]);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [expandedLossProductId, setExpandedLossProductId] = useState<string | null>(null);
  const [lossFilter, setLossFilter] = useState<"loss" | "gain" | "both">("both");
  // Tracks "auditId:productId" pairs that have already been adjusted this session
  const [adjustedItems, setAdjustedItems] = useState<Set<string>>(new Set());

  const [adjustDialog, setAdjustDialog] = useState<AdjustDialogState>({
    open: false, auditId: "", productId: "", productName: "", unitType: "",
    deltaKg: 0, deltaUnits: 0, deltaBoxes: 0,
    stockBeforeKg: 0, stockBeforeUnits: 0, stockBeforeBoxes: 0,
    notes: "", saving: false,
  });

  // ── Presets ──────────────────────────────────────────────────
  const presets = useMemo(() => {
    const now = new Date();
    const fmt = (d: Date) => format(d, "yyyy-MM-dd");
    return [
      { key: "today",      label: "Today",      from: today,                                                             to: today },
      { key: "yesterday",  label: "Yesterday",  from: fmt(subDays(now, 1)),                                               to: fmt(subDays(now, 1)) },
      { key: "this_week",  label: "This Week",  from: fmt(startOfWeek(now, { weekStartsOn: 1 })),                         to: today },
      { key: "last_week",  label: "Last Week",  from: fmt(startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })),            to: fmt(endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })) },
      { key: "this_month", label: "This Month", from: fmt(startOfMonth(now)),                                             to: today },
      { key: "last_month", label: "Last Month", from: fmt(startOfMonth(subMonths(now, 1))),                               to: fmt(endOfMonth(subMonths(now, 1))) },
    ];
  }, [today]);

  function applyPreset(p: typeof presets[0]) {
    setActivePreset(p.key);
    setDateFrom(p.from);
    setDateTo(p.to);
  }

  // ── Fetch products (for selling_price) ───────────────────────
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("products")
      .select("id, name, unit_type, selling_price")
      .eq("is_active", true)
      .then(({ data }) => setProducts((data as unknown as ProductWithCost[]) ?? []));
  }, []);

  // ── Fetch restocks ────────────────────────────────────────────
  const fetchRestocks = useCallback(async () => {
    setLoadingRestocks(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("stock_additions")
      .select(`
        id, created_at, quantity_kg, quantity_units, quantity_boxes,
        cost_price_per_unit, total_cost, supplier, notes,
        product:products(id, name, unit_type),
        added_by_profile:profiles!added_by(full_name)
      `)
      .gte("created_at", dateFrom + "T00:00:00")
      .lte("created_at", dateTo + "T23:59:59")
      .order("created_at", { ascending: false });
    setRestocks((data as unknown as StockAdditionRow[]) ?? []);
    setLoadingRestocks(false);
  }, [dateFrom, dateTo]);

  // ── Fetch adjustments ─────────────────────────────────────────
  const fetchAdjustments = useCallback(async () => {
    setLoadingAdjustments(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("stock_adjustments")
      .select(`
        id, created_at, quantity_kg_delta, quantity_units_delta, quantity_boxes_delta,
        reason, approval_status, notes,
        product:products(id, name, unit_type),
        created_by_profile:profiles!created_by(full_name),
        approved_by_profile:profiles!approved_by(full_name)
      `)
      .gte("created_at", dateFrom + "T00:00:00")
      .lte("created_at", dateTo + "T23:59:59")
      .order("created_at", { ascending: false });
    setAdjustments((data as unknown as StockAdjustmentRow[]) ?? []);
    setLoadingAdjustments(false);
  }, [dateFrom, dateTo]);

  // ── Fetch audits ──────────────────────────────────────────────
  const fetchAudits = useCallback(async () => {
    setLoadingAudits(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("stock_audits")
      .select(`
        id, created_at, audit_date, audit_type, status, notes, completed_at,
        conducted_by_profile:profiles!conducted_by(full_name),
        items:stock_audit_items(
          id, product_id,
          system_stock_kg, system_stock_units, system_stock_boxes,
          physical_stock_kg, physical_stock_units, physical_stock_boxes,
          variance_kg, variance_units, variance_boxes,
          variance_pct, within_threshold, notes,
          product:products(id, name, unit_type)
        )
      `)
      .gte("audit_date", dateFrom)
      .lte("audit_date", dateTo)
      .order("audit_date", { ascending: false });
    setAudits((data as unknown as StockAuditRow[]) ?? []);
    setLoadingAudits(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchRestocks(); fetchAdjustments(); fetchAudits(); }, [fetchRestocks, fetchAdjustments, fetchAudits]);

  // ── Variance analysis (derived from audits + products) ────────
  const lossAnalysis = useMemo(() => {
    type AuditEvent = {
      auditId: string;
      auditDate: string;
      delta: number;
      sys: number;
      phy: number;
      item: StockAuditItemRow;
    };
    type ProductEntry = {
      productId: string;
      productName: string;
      unitType: string;
      costPerUnit: number;
      totalLossQty: number;   // sum of |negative deltas|
      totalGainQty: number;   // sum of positive deltas
      lossEvents: AuditEvent[];
      gainEvents: AuditEvent[];
    };

    const productMap = new Map<string, ProductEntry>();

    for (const audit of audits) {
      if (audit.status !== "completed") continue;
      for (const item of audit.items) {
        const { sys, phy, delta, unit } = getVariance(item);
        if (delta === 0) continue;
        const prod = products.find((p) => p.id === item.product_id);
        const cost = prod?.selling_price ?? 0;

        if (!productMap.has(item.product_id)) {
          productMap.set(item.product_id, {
            productId: item.product_id,
            productName: item.product?.name ?? "Unknown",
            unitType: unit,
            costPerUnit: cost,
            totalLossQty: 0,
            totalGainQty: 0,
            lossEvents: [],
            gainEvents: [],
          });
        }
        const entry = productMap.get(item.product_id)!;
        const ev: AuditEvent = { auditId: audit.id, auditDate: audit.audit_date, delta, sys, phy, item };
        if (delta < 0) {
          entry.totalLossQty += Math.abs(delta);
          entry.lossEvents.push(ev);
        } else {
          entry.totalGainQty += delta;
          entry.gainEvents.push(ev);
        }
      }
    }

    const allProducts = Array.from(productMap.values());

    const totalEstimatedLoss = allProducts.reduce((s, p) => s + p.totalLossQty * p.costPerUnit, 0);
    const totalEstimatedGain = allProducts.reduce((s, p) => s + p.totalGainQty * p.costPerUnit, 0);
    const productsWithLoss   = allProducts.filter((p) => p.lossEvents.length > 0).length;
    const productsWithGain   = allProducts.filter((p) => p.gainEvents.length > 0).length;

    // Sort: biggest combined impact first
    const byProduct = allProducts.sort(
      (a, b) =>
        (b.totalLossQty * b.costPerUnit + b.totalGainQty * b.costPerUnit) -
        (a.totalLossQty * a.costPerUnit + a.totalGainQty * a.costPerUnit)
    );

    return {
      byProduct,
      totalEstimatedLoss,
      totalEstimatedGain,
      productsWithLoss,
      productsWithGain,
    };
  }, [audits, products]);

  // ── Adjust from variance ──────────────────────────────────────
  function openAdjustDialog(item: StockAuditItemRow, auditDate: string, auditId: string) {
    const { sys, phy, delta, unit } = getVariance(item);
    if (delta === 0) return;
    setAdjustDialog({
      open: true,
      auditId,
      productId: item.product_id,
      productName: item.product?.name ?? "",
      unitType: unit,
      deltaKg: unit === "kg" ? delta : 0,
      deltaUnits: unit === "units" ? delta : 0,
      deltaBoxes: unit === "boxes" ? delta : 0,
      stockBeforeKg: item.system_stock_kg,
      stockBeforeUnits: item.system_stock_units,
      stockBeforeBoxes: item.system_stock_boxes,
      notes: `Audit variance adjustment — audit date ${auditDate} (system: ${sys.toFixed(unit === "kg" ? 3 : 0)} ${unit}, physical: ${phy.toFixed(unit === "kg" ? 3 : 0)} ${unit})`,
      saving: false,
    });
  }

  async function handleAdjustFromVariance() {
    if (!profile) return;
    setAdjustDialog((d) => ({ ...d, saving: true }));
    const supabase = createClient();

    const { data, error } = await supabase
      .from("stock_adjustments")
      .insert({
        product_id: adjustDialog.productId,
        adjusted_by: profile.id,
        reason: "measurement_variance",
        reason_detail: adjustDialog.notes,
        quantity_kg_delta: adjustDialog.deltaKg,
        quantity_units_delta: adjustDialog.deltaUnits,
        quantity_boxes_delta: adjustDialog.deltaBoxes,
        stock_before_kg: adjustDialog.stockBeforeKg,
        stock_before_units: adjustDialog.stockBeforeUnits,
        stock_before_boxes: adjustDialog.stockBeforeBoxes,
        requires_approval: false,
        approval_status: "approved",
      })
      .select("id")
      .single();

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setAdjustDialog((d) => ({ ...d, saving: false }));
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile.id,
      action: "CREATE_ADJUSTMENT",
      entity_type: "stock_adjustments",
      entity_id: data.id,
      new_value: { product: adjustDialog.productName, source: "audit_variance", delta: adjustDialog.deltaKg || adjustDialog.deltaUnits || adjustDialog.deltaBoxes },
    });

    toast({ title: "Adjustment applied", description: `Stock updated for ${adjustDialog.productName}` });
    setAdjustedItems((prev) => new Set(prev).add(`${adjustDialog.auditId}:${adjustDialog.productId}`));
    setAdjustDialog((d) => ({ ...d, open: false, saving: false }));
    fetchAdjustments();
  }

  // ── Export restocks CSV ───────────────────────────────────────
  function exportRestocksCSV() {
    const rows = [
      "Date,Product,Qty Added,Boxes,Cost/Unit,Total Cost,Supplier,Notes,Added By",
      ...restocks.map((r) =>
        [
          format(parseISO(r.created_at), "yyyy-MM-dd HH:mm"),
          `"${r.product?.name ?? ""}"`,
          primaryQtyLabel(r),
          r.quantity_boxes,
          r.cost_price_per_unit.toFixed(2),
          r.total_cost.toFixed(2),
          `"${r.supplier ?? ""}"`,
          `"${r.notes ?? ""}"`,
          `"${r.added_by_profile?.full_name ?? ""}"`,
        ].join(",")
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `restocks_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportRestocksXLSX() {
    const data = [
      ["Date", "Product", "Qty Added", "Boxes", "Cost/Unit", "Total Cost", "Supplier", "Notes", "Added By"],
      ...restocks.map((r) => [
        format(parseISO(r.created_at), "yyyy-MM-dd HH:mm"),
        r.product?.name ?? "",
        primaryQtyLabel(r),
        r.quantity_boxes,
        r.cost_price_per_unit,
        r.total_cost,
        r.supplier ?? "",
        r.notes ?? "",
        r.added_by_profile?.full_name ?? "",
      ]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Restocks");
    XLSX.writeFile(wb, `restocks_${dateFrom}_to_${dateTo}.xlsx`);
  }

  // ── Export adjustments CSV ────────────────────────────────────
  function exportAdjustmentsCSV() {
    const rows = [
      "Date,Product,Delta,Reason,Status,Notes,Created By,Approved By",
      ...adjustments.map((r) => {
        const d = deltaLabel(r);
        return [
          format(parseISO(r.created_at), "yyyy-MM-dd HH:mm"),
          `"${r.product?.name ?? ""}"`,
          d.text,
          `"${r.reason}"`,
          r.approval_status,
          `"${r.notes ?? ""}"`,
          `"${r.created_by_profile?.full_name ?? ""}"`,
          `"${r.approved_by_profile?.full_name ?? ""}"`,
        ].join(",");
      }),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adjustments_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAdjustmentsXLSX() {
    const data = [
      ["Date", "Product", "Delta", "Reason", "Status", "Notes", "Created By", "Approved By"],
      ...adjustments.map((r) => {
        const d = deltaLabel(r);
        return [
          format(parseISO(r.created_at), "yyyy-MM-dd HH:mm"),
          r.product?.name ?? "",
          d.text,
          r.reason,
          r.approval_status,
          r.notes ?? "",
          r.created_by_profile?.full_name ?? "",
          r.approved_by_profile?.full_name ?? "",
        ];
      }),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Adjustments");
    XLSX.writeFile(wb, `adjustments_${dateFrom}_to_${dateTo}.xlsx`);
  }

  // ── Export audits CSV ─────────────────────────────────────────
  function exportAuditsCSV() {
    const rows = [
      "Audit Date,Type,Status,Conducted By,Total Items,Items With Variance,Notes",
      ...audits.map((a) => {
        const variances = a.items.filter((i) => getVariance(i).delta !== 0).length;
        return [
          a.audit_date, a.audit_type, a.status,
          `"${a.conducted_by_profile?.full_name ?? ""}"`,
          a.items.length, variances,
          `"${a.notes ?? ""}"`,
        ].join(",");
      }),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audits_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAuditsXLSX() {
    const wb = XLSX.utils.book_new();
    const summary = [
      ["Audit Date", "Type", "Status", "Conducted By", "Total Items", "Items With Variance", "Notes"],
      ...audits.map((a) => {
        const variances = a.items.filter((i) => getVariance(i).delta !== 0).length;
        return [a.audit_date, a.audit_type, a.status, a.conducted_by_profile?.full_name ?? "", a.items.length, variances, a.notes ?? ""];
      }),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Audits Summary");
    const detail = [
      ["Audit Date", "Audit Type", "Product", "System Stock", "Physical Stock", "Variance", "Within Threshold", "Notes"],
      ...audits.flatMap((a) =>
        a.items.map((item) => {
          const { sys, phy, delta, unit } = getVariance(item);
          return [
            a.audit_date, a.audit_type, item.product?.name ?? "",
            `${sys} ${unit}`, `${phy} ${unit}`,
            `${delta >= 0 ? "+" : ""}${delta} ${unit}`,
            item.within_threshold ? "Yes" : "No",
            item.notes ?? "",
          ];
        })
      ),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), "Audit Detail");
    XLSX.writeFile(wb, `audits_${dateFrom}_to_${dateTo}.xlsx`);
  }

  // ── Export variance analysis CSV ─────────────────────────────
  function exportLossCSV() {
    const rows = [
      "Product,Unit Type,Total Loss Qty,Total Gain Qty,Selling Price/Unit,Est. Loss Value,Est. Gain Value,Loss Events,Gain Events",
      ...lossAnalysis.byProduct.map((p) =>
        [
          `"${p.productName}"`,
          p.unitType,
          p.totalLossQty.toFixed(p.unitType === "kg" ? 3 : 0),
          p.totalGainQty.toFixed(p.unitType === "kg" ? 3 : 0),
          p.costPerUnit.toFixed(2),
          (p.totalLossQty * p.costPerUnit).toFixed(2),
          (p.totalGainQty * p.costPerUnit).toFixed(2),
          p.lossEvents.length,
          p.gainEvents.length,
        ].join(",")
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `variance_analysis_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportLossXLSX() {
    const data = [
      ["Product", "Unit Type", "Total Loss Qty", "Total Gain Qty", "Selling Price/Unit", "Est. Loss Value", "Est. Gain Value", "Loss Events", "Gain Events"],
      ...lossAnalysis.byProduct.map((p) => [
        p.productName, p.unitType,
        p.totalLossQty, p.totalGainQty,
        p.costPerUnit,
        p.totalLossQty * p.costPerUnit,
        p.totalGainQty * p.costPerUnit,
        p.lossEvents.length,
        p.gainEvents.length,
      ]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Variance Analysis");
    XLSX.writeFile(wb, `variance_analysis_${dateFrom}_to_${dateTo}.xlsx`);
  }

  const isLoading =
    activeSubTab === "restocks" ? loadingRestocks
    : activeSubTab === "adjustments" ? loadingAdjustments
    : loadingAudits; // "audits" and "loss" both use audit data

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b pb-0">
        {(
          [
            { key: "restocks",    label: "Restocks" },
            { key: "adjustments", label: "Adjustments" },
            { key: "audits",      label: "Stock Audits" },
            { key: "loss",        label: "Loss Analysis" },
          ] as { key: "restocks" | "adjustments" | "audits" | "loss"; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeSubTab === tab.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-1.5 items-center">
          {presets.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                activePreset === p.key
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-blue-400 hover:text-blue-600"
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => { setDateFrom(e.target.value); setActivePreset("custom"); }}
              className="text-xs border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={today}
              onChange={(e) => { setDateTo(e.target.value); setActivePreset("custom"); }}
              className="text-xs border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={
              activeSubTab === "restocks" ? exportRestocksCSV
              : activeSubTab === "adjustments" ? exportAdjustmentsCSV
              : activeSubTab === "audits" ? exportAuditsCSV
              : exportLossCSV
            }
            className="gap-1.5 text-xs h-8"
          >
            <Download className="h-3 w-3" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={
              activeSubTab === "restocks" ? exportRestocksXLSX
              : activeSubTab === "adjustments" ? exportAdjustmentsXLSX
              : activeSubTab === "audits" ? exportAuditsXLSX
              : exportLossXLSX
            }
            className="gap-1.5 text-xs h-8"
          >
            <FileSpreadsheet className="h-3 w-3" /> XLSX
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {!isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {activeSubTab === "restocks" ? (
            <>
              <Card className="bg-blue-50 border-blue-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-blue-600">Total Restocks</p>
                  <p className="text-xl font-bold text-blue-900">{restocks.length}</p>
                  <p className="text-xs text-blue-600">in selected period</p>
                </CardContent>
              </Card>
              <Card className="bg-green-50 border-green-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-green-600">Total Cost</p>
                  <p className="text-xl font-bold text-green-900">
                    {formatCurrency(restocks.reduce((s, r) => s + (r.total_cost ?? 0), 0))}
                  </p>
                  <p className="text-xs text-green-600">across all restocks</p>
                </CardContent>
              </Card>
            </>
          ) : activeSubTab === "adjustments" ? (
            <>
              <Card className="bg-blue-50 border-blue-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-blue-600">Total Adjustments</p>
                  <p className="text-xl font-bold text-blue-900">{adjustments.length}</p>
                  <p className="text-xs text-blue-600">in selected period</p>
                </CardContent>
              </Card>
              <Card className="bg-amber-50 border-amber-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-amber-600">Pending Approval</p>
                  <p className="text-xl font-bold text-amber-900">
                    {adjustments.filter((a) => a.approval_status === "pending").length}
                  </p>
                  <p className="text-xs text-amber-600">awaiting review</p>
                </CardContent>
              </Card>
            </>
          ) : activeSubTab === "audits" ? (
            <>
              <Card className="bg-blue-50 border-blue-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-blue-600">Total Audits</p>
                  <p className="text-xl font-bold text-blue-900">{audits.length}</p>
                  <p className="text-xs text-blue-600">in selected period</p>
                </CardContent>
              </Card>
              <Card className="bg-red-50 border-red-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-red-600">Items With Variance</p>
                  <p className="text-xl font-bold text-red-900">
                    {audits.flatMap((a) => a.items).filter((i) => getVariance(i).delta !== 0).length}
                  </p>
                  <p className="text-xs text-red-600">across all audits</p>
                </CardContent>
              </Card>
            </>
          ) : lossFilter === "loss" ? (
            <>
              <Card className="bg-red-50 border-red-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-red-600">Products with Loss</p>
                  <p className="text-xl font-bold text-red-900">{lossAnalysis.productsWithLoss}</p>
                  <p className="text-xs text-red-600">in selected period</p>
                </CardContent>
              </Card>
              <Card className="bg-amber-50 border-amber-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-amber-600">Estimated Loss Value</p>
                  <p className="text-xl font-bold text-amber-900">
                    {formatCurrency(lossAnalysis.totalEstimatedLoss)}
                  </p>
                  <p className="text-xs text-amber-600">based on selling price</p>
                </CardContent>
              </Card>
            </>
          ) : lossFilter === "gain" ? (
            <>
              <Card className="bg-green-50 border-green-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-green-600">Products with Gain</p>
                  <p className="text-xl font-bold text-green-900">{lossAnalysis.productsWithGain}</p>
                  <p className="text-xs text-green-600">in selected period</p>
                </CardContent>
              </Card>
              <Card className="bg-blue-50 border-blue-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-blue-600">Estimated Gain Value</p>
                  <p className="text-xl font-bold text-blue-900">
                    {formatCurrency(lossAnalysis.totalEstimatedGain)}
                  </p>
                  <p className="text-xs text-blue-600">based on selling price</p>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Card className="bg-red-50 border-red-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-red-600">Est. Loss</p>
                  <p className="text-xl font-bold text-red-900">{formatCurrency(lossAnalysis.totalEstimatedLoss)}</p>
                  <p className="text-xs text-red-600">{lossAnalysis.productsWithLoss} product{lossAnalysis.productsWithLoss !== 1 ? "s" : ""}</p>
                </CardContent>
              </Card>
              <Card className="bg-green-50 border-green-100">
                <CardContent className="p-3">
                  <p className="text-xs font-medium text-green-600">Est. Gain</p>
                  <p className="text-xl font-bold text-green-900">{formatCurrency(lossAnalysis.totalEstimatedGain)}</p>
                  <p className="text-xs text-green-600">{lossAnalysis.productsWithGain} product{lossAnalysis.productsWithGain !== 1 ? "s" : ""}</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : activeSubTab === "restocks" ? (

        /* ══════════════ RESTOCKS TABLE ══════════════ */
        <Card>
          <CardContent className="p-0">
            {restocks.length === 0 ? (
              <div className="py-20 text-center text-sm text-slate-500">No restocks recorded for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Date</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Product</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Qty Added</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Boxes</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Cost/Unit</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Total Cost</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Supplier</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Notes</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Added By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {restocks.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-600 text-xs whitespace-nowrap">
                          {format(parseISO(row.created_at), "d MMM yyyy HH:mm")}
                        </td>
                        <td className="px-4 py-2.5 font-medium">{row.product?.name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{primaryQtyLabel(row)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {row.quantity_boxes > 0 ? row.quantity_boxes : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">{formatCurrency(row.cost_price_per_unit)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(row.total_cost)}</td>
                        <td className="px-4 py-2.5 text-slate-600 text-xs">{row.supplier ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-slate-600 text-xs">{row.notes ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-slate-600 text-xs">{row.added_by_profile?.full_name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      ) : activeSubTab === "audits" ? (

        /* ══════════════ AUDITS TABLE ══════════════ */
        <Card>
          <CardContent className="p-0">
            {audits.length === 0 ? (
              <div className="py-20 text-center text-sm text-slate-500">No stock audits recorded for this period</div>
            ) : (
              <div className="divide-y">
                {audits.map((audit) => {
                  const isExpanded = expandedAuditId === audit.id;
                  const lossItems = audit.items.filter((i) => getVariance(i).delta < 0);
                  const gainItems = audit.items.filter((i) => getVariance(i).delta > 0);
                  return (
                    <div key={audit.id}>
                      {/* Audit header row */}
                      <button
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3"
                        onClick={() => setExpandedAuditId(isExpanded ? null : audit.id)}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        }
                        <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2 items-center text-sm">
                          <span className="font-medium text-slate-800">
                            {format(parseISO(audit.audit_date), "d MMM yyyy")}
                          </span>
                          <span className="hidden sm:block">{auditTypeBadge(audit.audit_type)}</span>
                          <span>{statusBadge(audit.status)}</span>
                          <span className="hidden sm:block text-slate-500 text-xs">
                            {audit.conducted_by_profile?.full_name ?? "—"}
                          </span>
                          <span className="text-xs text-slate-500 text-right sm:text-left">
                            {audit.items.length} item{audit.items.length !== 1 ? "s" : ""}
                            {lossItems.length > 0 && (
                              <span className="ml-1.5 text-red-600 font-medium">
                                · {lossItems.length} loss
                              </span>
                            )}
                            {gainItems.length > 0 && (
                              <span className="ml-1.5 text-green-600 font-medium">
                                · {gainItems.length} gain
                              </span>
                            )}
                          </span>
                        </div>
                      </button>

                      {/* Expanded items */}
                      {isExpanded && audit.items.length > 0 && (
                        <div className="bg-slate-50 border-t px-4 py-3">
                          {audit.notes && (
                            <p className="text-xs text-slate-500 mb-3 italic">{audit.notes}</p>
                          )}
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-400">
                                  <th className="text-left py-1.5 pr-4 font-medium">Product</th>
                                  <th className="text-right py-1.5 pr-4 font-medium">System Stock</th>
                                  <th className="text-right py-1.5 pr-4 font-medium">Physical Count</th>
                                  <th className="text-right py-1.5 pr-4 font-medium">Variance</th>
                                  <th className="text-center py-1.5 pr-4 font-medium">OK?</th>
                                  <th className="text-center py-1.5 font-medium">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {audit.items.map((item) => {
                                  const { sys, phy, delta, unit } = getVariance(item);
                                  const hasVariance = delta !== 0;
                                  const isLoss = delta < 0;
                                  return (
                                    <tr key={item.id} className={isLoss ? "bg-red-50" : hasVariance ? "bg-green-50/50" : ""}>
                                      <td className="py-2 pr-4 font-medium text-slate-700">{item.product?.name ?? "—"}</td>
                                      <td className="py-2 pr-4 text-right text-slate-600">{sys.toFixed(unit === "kg" ? 3 : 0)} {unit}</td>
                                      <td className="py-2 pr-4 text-right text-slate-600">{phy.toFixed(unit === "kg" ? 3 : 0)} {unit}</td>
                                      <td className={`py-2 pr-4 text-right font-semibold ${isLoss ? "text-red-600" : hasVariance ? "text-green-600" : "text-slate-400"}`}>
                                        {delta >= 0 ? "+" : ""}{delta.toFixed(unit === "kg" ? 3 : 0)} {unit}
                                      </td>
                                      <td className="py-2 pr-4 text-center">
                                        {item.within_threshold
                                          ? <span className="text-green-600">✓</span>
                                          : <span className="text-red-600">✗</span>
                                        }
                                      </td>
                                      <td className="py-2 text-center">
                                        {hasVariance && audit.status === "completed" ? (
                                          adjustedItems.has(`${audit.id}:${item.product_id}`) ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-600 cursor-default">
                                              ✓ Adjusted
                                            </span>
                                          ) : (
                                            <button
                                              onClick={() => openAdjustDialog(item, audit.audit_date, audit.id)}
                                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                                              title="Create stock adjustment based on this variance"
                                            >
                                              <SlidersHorizontal className="h-3 w-3" />
                                              Adjust
                                            </button>
                                          )
                                        ) : (
                                          <span className="text-slate-300">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

      ) : activeSubTab === "loss" ? (

        /* ══════════════ VARIANCE ANALYSIS ══════════════ */
        <div className="space-y-3">
          {/* Filter toggle — same pill style as sales history matrix metric */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {lossFilter === "loss" ? "Showing products with stock loss" : lossFilter === "gain" ? "Showing products with stock gain" : "Showing all variance events"}
            </p>
            <div className="flex gap-0.5 border border-slate-200 rounded-md p-0.5">
              {(["loss", "gain", "both"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setLossFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    lossFilter === f ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {f === "both" ? "Loss + Gain" : f === "loss" ? "Loss" : "Gain"}
                </button>
              ))}
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {lossAnalysis.byProduct.filter((e) =>
                lossFilter === "loss" ? e.lossEvents.length > 0
                : lossFilter === "gain" ? e.gainEvents.length > 0
                : true
              ).length === 0 ? (
                <div className="py-20 text-center text-sm text-slate-500">
                  <TrendingDown className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                  No {lossFilter === "gain" ? "gains" : "losses"} recorded for this period
                </div>
              ) : (
                <div className="divide-y">
                  {lossAnalysis.byProduct
                    .filter((e) =>
                      lossFilter === "loss" ? e.lossEvents.length > 0
                      : lossFilter === "gain" ? e.gainEvents.length > 0
                      : true
                    )
                    .map((entry) => {
                      const isExpanded = expandedLossProductId === entry.productId;
                      const isKg = entry.unitType === "kg";
                      const fmt3 = (n: number) => n.toFixed(isKg ? 3 : 0);
                      const showLoss = lossFilter === "loss" || lossFilter === "both";
                      const showGain = lossFilter === "gain" || lossFilter === "both";
                      return (
                        <div key={entry.productId}>
                          {/* Product summary row */}
                          <button
                            className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3"
                            onClick={() => setExpandedLossProductId(isExpanded ? null : entry.productId)}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                              : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                            }
                            <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2 items-center text-sm">
                              <span className="font-medium text-slate-800">{entry.productName}</span>
                              <span className="hidden sm:block text-xs text-slate-500 capitalize">{entry.unitType}</span>
                              <span className="flex flex-col gap-0.5 text-xs font-semibold">
                                {showLoss && entry.lossEvents.length > 0 && (
                                  <span className="text-red-600">-{fmt3(entry.totalLossQty)} {entry.unitType}</span>
                                )}
                                {showGain && entry.gainEvents.length > 0 && (
                                  <span className="text-green-600">+{fmt3(entry.totalGainQty)} {entry.unitType}</span>
                                )}
                              </span>
                              <span className="hidden sm:block text-xs text-slate-500">
                                {entry.costPerUnit > 0
                                  ? `${formatCurrency(entry.costPerUnit)} / ${entry.unitType}`
                                  : <span className="text-slate-300">no price set</span>
                                }
                              </span>
                              <span className="flex flex-col gap-0.5 text-xs font-semibold">
                                {showLoss && entry.lossEvents.length > 0 && (
                                  <span className="text-red-700">
                                    - {formatCurrency(entry.totalLossQty * entry.costPerUnit)}
                                    <span className="ml-1 font-normal text-slate-400">· {entry.lossEvents.length} loss</span>
                                  </span>
                                )}
                                {showGain && entry.gainEvents.length > 0 && (
                                  <span className="text-green-700">
                                    + {formatCurrency(entry.totalGainQty * entry.costPerUnit)}
                                    <span className="ml-1 font-normal text-slate-400">· {entry.gainEvents.length} gain</span>
                                  </span>
                                )}
                              </span>
                            </div>
                          </button>

                          {/* Expanded: per-audit events */}
                          {isExpanded && (
                            <div className="border-t px-4 py-3 bg-slate-50/60 space-y-4">
                              {/* Loss events */}
                              {showLoss && entry.lossEvents.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">
                                    Loss Events ({entry.lossEvents.length})
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-slate-400">
                                          <th className="text-left py-1.5 pr-4 font-medium">Audit Date</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">System</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">Physical</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">Loss</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">Est. Cost</th>
                                          <th className="text-center py-1.5 font-medium">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-red-100">
                                        {entry.lossEvents.map((ev) => {
                                          const absLoss = Math.abs(ev.delta);
                                          const eventCost = absLoss * entry.costPerUnit;
                                          return (
                                            <tr key={`${ev.auditId}-${entry.productId}-loss`} className="bg-red-50/30">
                                              <td className="py-2 pr-4 font-medium text-slate-700">{format(parseISO(ev.auditDate), "d MMM yyyy")}</td>
                                              <td className="py-2 pr-4 text-right text-slate-600">{fmt3(ev.sys)} {entry.unitType}</td>
                                              <td className="py-2 pr-4 text-right text-slate-600">{fmt3(ev.phy)} {entry.unitType}</td>
                                              <td className="py-2 pr-4 text-right font-semibold text-red-600">-{fmt3(absLoss)} {entry.unitType}</td>
                                              <td className="py-2 pr-4 text-right text-red-700">{eventCost > 0 ? `- ${formatCurrency(eventCost)}` : "—"}</td>
                                              <td className="py-2 text-center">
                                                {adjustedItems.has(`${ev.auditId}:${entry.productId}`) ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-600 cursor-default">✓ Adjusted</span>
                                                ) : (
                                                  <button
                                                    onClick={() => openAdjustDialog(ev.item, ev.auditDate, ev.auditId)}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                                                  >
                                                    <SlidersHorizontal className="h-3 w-3" /> Adjust
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Gain events */}
                              {showGain && entry.gainEvents.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-2">
                                    Gain Events ({entry.gainEvents.length})
                                  </p>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-slate-400">
                                          <th className="text-left py-1.5 pr-4 font-medium">Audit Date</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">System</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">Physical</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">Gain</th>
                                          <th className="text-right py-1.5 pr-4 font-medium">Est. Value</th>
                                          <th className="text-center py-1.5 font-medium">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-green-100">
                                        {entry.gainEvents.map((ev) => {
                                          const eventValue = ev.delta * entry.costPerUnit;
                                          return (
                                            <tr key={`${ev.auditId}-${entry.productId}-gain`} className="bg-green-50/30">
                                              <td className="py-2 pr-4 font-medium text-slate-700">{format(parseISO(ev.auditDate), "d MMM yyyy")}</td>
                                              <td className="py-2 pr-4 text-right text-slate-600">{fmt3(ev.sys)} {entry.unitType}</td>
                                              <td className="py-2 pr-4 text-right text-slate-600">{fmt3(ev.phy)} {entry.unitType}</td>
                                              <td className="py-2 pr-4 text-right font-semibold text-green-600">+{fmt3(ev.delta)} {entry.unitType}</td>
                                              <td className="py-2 pr-4 text-right text-green-700">{eventValue > 0 ? `+ ${formatCurrency(eventValue)}` : "—"}</td>
                                              <td className="py-2 text-center">
                                                {adjustedItems.has(`${ev.auditId}:${entry.productId}`) ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-600 cursor-default">✓ Adjusted</span>
                                                ) : (
                                                  <button
                                                    onClick={() => openAdjustDialog(ev.item, ev.auditDate, ev.auditId)}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                                                  >
                                                    <SlidersHorizontal className="h-3 w-3" /> Adjust
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      ) : (

        /* ══════════════ ADJUSTMENTS TABLE ══════════════ */
        <Card>
          <CardContent className="p-0">
            {adjustments.length === 0 ? (
              <div className="py-20 text-center text-sm text-slate-500">No adjustments recorded for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Date</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Product</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Delta</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Reason</th>
                      <th className="text-center px-4 py-2.5 font-medium text-slate-500 text-xs">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Notes</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Created By</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Approved By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {adjustments.map((row) => {
                      const d = deltaLabel(row);
                      return (
                        <tr key={row.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-slate-600 text-xs whitespace-nowrap">
                            {format(parseISO(row.created_at), "d MMM yyyy HH:mm")}
                          </td>
                          <td className="px-4 py-2.5 font-medium">{row.product?.name ?? "—"}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${d.positive ? "text-green-600" : "text-red-600"}`}>
                            {d.text}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs">{row.reason}</td>
                          <td className="px-4 py-2.5 text-center">{statusBadge(row.approval_status)}</td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs">{row.notes ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs">{row.created_by_profile?.full_name ?? "—"}</td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs">{row.approved_by_profile?.full_name ?? <span className="text-slate-300">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Adjust from Variance Dialog ──────────────────────── */}
      <Dialog
        open={adjustDialog.open}
        onOpenChange={(open) => !adjustDialog.saving && setAdjustDialog((d) => ({ ...d, open }))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-blue-500" />
              Adjust Stock from Audit Variance
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {/* Product info */}
            <div className="bg-slate-50 rounded-lg p-3 space-y-1">
              <p className="font-medium text-slate-800">{adjustDialog.productName}</p>
              <p className="text-xs text-slate-500 capitalize">{adjustDialog.unitType}</p>
            </div>

            {/* Delta (read-only display) */}
            <div className="bg-red-50 border border-red-100 rounded-lg p-3">
              <p className="text-xs font-medium text-red-600 mb-0.5">Stock Adjustment</p>
              <p className={`font-semibold ${
                (adjustDialog.deltaKg || adjustDialog.deltaUnits || adjustDialog.deltaBoxes) < 0
                  ? "text-red-700" : "text-green-700"
              }`}>
                {(() => {
                  const delta = adjustDialog.deltaKg || adjustDialog.deltaUnits || adjustDialog.deltaBoxes;
                  const unit = adjustDialog.unitType;
                  return `${delta >= 0 ? "+" : ""}${delta.toFixed(unit === "kg" ? 3 : 0)} ${unit}`;
                })()}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Reason: <span className="font-medium">Measurement Variance</span>
                <span className="ml-1">(pre-approved — audit verified)</span>
              </p>
            </div>

            {/* Notes (editable) */}
            <div>
              <Label className="text-xs text-slate-600">Notes</Label>
              <textarea
                rows={3}
                value={adjustDialog.notes}
                onChange={(e) => setAdjustDialog((d) => ({ ...d, notes: e.target.value }))}
                className="mt-1 w-full text-xs border border-slate-200 rounded-md px-3 py-2 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAdjustDialog((d) => ({ ...d, open: false }))}
              disabled={adjustDialog.saving}
            >
              Cancel
            </Button>
            <Button onClick={handleAdjustFromVariance} disabled={adjustDialog.saving}>
              {adjustDialog.saving ? "Applying..." : "Apply Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
