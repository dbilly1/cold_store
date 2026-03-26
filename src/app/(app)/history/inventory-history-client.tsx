"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";

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
  if (status === "approved") return <span className={`${base} bg-green-100 text-green-700`}>Approved</span>;
  if (status === "rejected") return <span className={`${base} bg-red-100 text-red-700`}>Rejected</span>;
  return <span className={`${base} bg-amber-100 text-amber-700`}>Pending</span>;
}

// ── Component ──────────────────────────────────────────────────

export function InventoryHistoryClient() {
  const today = format(new Date(), "yyyy-MM-dd");

  const [activeSubTab, setActiveSubTab] = useState<"restocks" | "adjustments">("restocks");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [activePreset, setActivePreset] = useState("today");

  const [loadingRestocks, setLoadingRestocks] = useState(true);
  const [loadingAdjustments, setLoadingAdjustments] = useState(true);
  const [restocks, setRestocks] = useState<StockAdditionRow[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustmentRow[]>([]);

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

  useEffect(() => { fetchRestocks(); fetchAdjustments(); }, [fetchRestocks, fetchAdjustments]);

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

  const isLoading = activeSubTab === "restocks" ? loadingRestocks : loadingAdjustments;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b pb-0">
        {(
          [
            { key: "restocks", label: "Restocks" },
            { key: "adjustments", label: "Adjustments" },
          ] as { key: "restocks" | "adjustments"; label: string }[]
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
            onClick={activeSubTab === "restocks" ? exportRestocksCSV : exportAdjustmentsCSV}
            className="gap-1.5 text-xs h-8"
          >
            <Download className="h-3 w-3" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={activeSubTab === "restocks" ? exportRestocksXLSX : exportAdjustmentsXLSX}
            className="gap-1.5 text-xs h-8"
          >
            <FileSpreadsheet className="h-3 w-3" /> XLSX
          </Button>
        </div>
      </div>

      {/* Summary card */}
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
          ) : (
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

    </div>
  );
}
