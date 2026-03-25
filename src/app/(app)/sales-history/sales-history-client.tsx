"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import {
  format, subDays, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, subWeeks, subMonths,
  eachDayOfInterval, differenceInDays, parseISO,
} from "date-fns";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Loader2, TableProperties, Grid3X3 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

interface ProductMeta {
  id: string;
  name: string;
  unit_type: string;
}

interface SaleItemRow {
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  line_total: number;
  cost_price_at_sale: number;
  product: ProductMeta | null;
}

interface SaleRow {
  id: string;
  sale_date: string;
  payment_method: string;
  sale_items: SaleItemRow[];
}

interface ProductSummary {
  productId: string;
  productName: string;
  unitType: string;
  totalQty: number;
  cashRevenue: number;
  mobileRevenue: number;
  creditRevenue: number;
  totalRevenue: number;
  cogs: number;
}

// ── Helpers ────────────────────────────────────────────────────

function itemQty(item: SaleItemRow): number {
  return (item.quantity_kg || 0) + (item.quantity_units || 0) + (item.quantity_boxes || 0);
}

function fmtQty(qty: number, unitType: string): string {
  if (unitType === "kg") return `${qty % 1 === 0 ? qty : qty.toFixed(2)} kg`;
  if (unitType === "units") return `${qty} units`;
  return `${qty} boxes`;
}

// ── Component ──────────────────────────────────────────────────

export function SalesHistoryClient() {
  const today = format(new Date(), "yyyy-MM-dd");

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo]     = useState(today);
  const [activePreset, setActivePreset] = useState("today");
  const [viewMode, setViewMode] = useState<"summary" | "matrix">("summary");
  const [matrixMetric, setMatrixMetric] = useState<"qty" | "revenue" | "both">("both");
  const [loading, setLoading]   = useState(true);
  const [sales, setSales]       = useState<SaleRow[]>([]);

  const daySpan    = differenceInDays(parseISO(dateTo), parseISO(dateFrom)) + 1;
  const isMultiDay = daySpan > 1;

  // ── Presets ────────────────────────────────────────────────
  const presets = useMemo(() => {
    const now = new Date();
    const fmt = (d: Date) => format(d, "yyyy-MM-dd");
    return [
      { key: "today",      label: "Today",      from: today,                                     to: today },
      { key: "yesterday",  label: "Yesterday",  from: fmt(subDays(now, 1)),                      to: fmt(subDays(now, 1)) },
      { key: "this_week",  label: "This Week",  from: fmt(startOfWeek(now, { weekStartsOn: 1 })), to: today },
      { key: "last_week",  label: "Last Week",  from: fmt(startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })), to: fmt(endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 })) },
      { key: "this_month", label: "This Month", from: fmt(startOfMonth(now)),                    to: today },
      { key: "last_month", label: "Last Month", from: fmt(startOfMonth(subMonths(now, 1))),      to: fmt(endOfMonth(subMonths(now, 1))) },
    ];
  }, [today]);

  function applyPreset(p: typeof presets[0]) {
    setActivePreset(p.key);
    setDateFrom(p.from);
    setDateTo(p.to);
  }

  // Auto-switch view mode when range changes
  useEffect(() => {
    setViewMode(isMultiDay ? "matrix" : "summary");
  }, [isMultiDay]);

  // ── Data fetch ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("sales")
      .select(`
        id, sale_date, payment_method,
        sale_items(
          quantity_kg, quantity_units, quantity_boxes,
          line_total, cost_price_at_sale,
          product:products(id, name, unit_type)
        )
      `)
      .gte("sale_date", dateFrom)
      .lte("sale_date", dateTo)
      .eq("is_deleted", false)
      .order("sale_date", { ascending: true });
    setSales((data as SaleRow[]) ?? []);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Summary aggregation ────────────────────────────────────
  const summaryRows = useMemo((): ProductSummary[] => {
    const map = new Map<string, ProductSummary>();
    for (const sale of sales) {
      for (const item of sale.sale_items ?? []) {
        if (!item.product) continue;
        const pid = item.product.id;
        if (!map.has(pid)) {
          map.set(pid, {
            productId: pid, productName: item.product.name,
            unitType: item.product.unit_type,
            totalQty: 0, cashRevenue: 0, mobileRevenue: 0,
            creditRevenue: 0, totalRevenue: 0, cogs: 0,
          });
        }
        const row = map.get(pid)!;
        const qty = itemQty(item);
        row.totalQty      += qty;
        row.totalRevenue  += item.line_total;
        row.cogs          += qty * (item.cost_price_at_sale || 0);
        if (sale.payment_method === "cash")         row.cashRevenue   += item.line_total;
        else if (sale.payment_method === "mobile_money") row.mobileRevenue += item.line_total;
        else if (sale.payment_method === "credit")  row.creditRevenue += item.line_total;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [sales]);

  const summaryTotals = useMemo(() => ({
    totalRevenue:  summaryRows.reduce((s, r) => s + r.totalRevenue,  0),
    cashRevenue:   summaryRows.reduce((s, r) => s + r.cashRevenue,   0),
    mobileRevenue: summaryRows.reduce((s, r) => s + r.mobileRevenue, 0),
    creditRevenue: summaryRows.reduce((s, r) => s + r.creditRevenue, 0),
    cogs:          summaryRows.reduce((s, r) => s + r.cogs,          0),
    transactions:  sales.length,
  }), [summaryRows, sales]);

  // ── Matrix aggregation ─────────────────────────────────────
  const matrixDays = useMemo(() =>
    eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) })
      .map(d => format(d, "yyyy-MM-dd")),
    [dateFrom, dateTo]
  );

  const matrixProducts = useMemo(() => {
    const productMeta = new Map<string, ProductMeta>();
    const dataMap = new Map<string, Map<string, { qty: number; revenue: number }>>();

    for (const sale of sales) {
      for (const item of sale.sale_items ?? []) {
        if (!item.product) continue;
        const pid = item.product.id;
        if (!productMeta.has(pid)) {
          productMeta.set(pid, item.product);
          dataMap.set(pid, new Map());
        }
        const dayMap = dataMap.get(pid)!;
        const existing = dayMap.get(sale.sale_date) ?? { qty: 0, revenue: 0 };
        existing.qty     += itemQty(item);
        existing.revenue += item.line_total;
        dayMap.set(sale.sale_date, existing);
      }
    }

    return Array.from(productMeta.entries())
      .map(([pid, meta]) => {
        const dayMap   = dataMap.get(pid)!;
        const totalQty = Array.from(dayMap.values()).reduce((s, v) => s + v.qty, 0);
        const totalRev = Array.from(dayMap.values()).reduce((s, v) => s + v.revenue, 0);
        return { pid, name: meta.name, unitType: meta.unit_type, dayMap, totalQty, totalRev };
      })
      .sort((a, b) => b.totalRev - a.totalRev);
  }, [sales]);

  const matrixColTotals = useMemo(() =>
    matrixDays.map(day => {
      let qty = 0, revenue = 0;
      for (const p of matrixProducts) {
        const cell = p.dayMap.get(day);
        if (cell) { qty += cell.qty; revenue += cell.revenue; }
      }
      return { day, qty, revenue };
    }),
    [matrixDays, matrixProducts]
  );

  // ── Exports ────────────────────────────────────────────────
  function exportCSV() {
    let csv = "";
    if (!isMultiDay || viewMode === "summary") {
      const rows = [
        "Product,Unit,Qty Sold,Cash,Mobile,Credit,Total Revenue,COGS,Gross Profit",
        ...summaryRows.map(r =>
          `"${r.productName}",${r.unitType},${r.totalQty},` +
          `${r.cashRevenue.toFixed(2)},${r.mobileRevenue.toFixed(2)},${r.creditRevenue.toFixed(2)},` +
          `${r.totalRevenue.toFixed(2)},${r.cogs.toFixed(2)},${(r.totalRevenue - r.cogs).toFixed(2)}`
        ),
        `TOTAL,,,${summaryTotals.cashRevenue.toFixed(2)},${summaryTotals.mobileRevenue.toFixed(2)},` +
        `${summaryTotals.creditRevenue.toFixed(2)},${summaryTotals.totalRevenue.toFixed(2)},` +
        `${summaryTotals.cogs.toFixed(2)},${(summaryTotals.totalRevenue - summaryTotals.cogs).toFixed(2)}`,
      ];
      csv = rows.join("\n");
    } else {
      const dayHeaders = matrixDays.map(d => format(parseISO(d), "EEE d MMM")).join(",");
      const rows = [
        `Product,Unit,${dayHeaders},Total Qty,Total Revenue`,
        ...matrixProducts.map(p => {
          const cells = matrixDays.map(d => { const c = p.dayMap.get(d); return c ? c.qty : 0; }).join(",");
          return `"${p.name}",${p.unitType},${cells},${p.totalQty},${p.totalRev.toFixed(2)}`;
        }),
      ];
      csv = rows.join("\n");
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `sales_${dateFrom}_to_${dateTo}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportXLSX() {
    const wb = XLSX.utils.book_new();

    if (!isMultiDay || viewMode === "summary") {
      const data = [
        ["Product", "Unit", "Qty Sold", "Cash", "Mobile", "Credit", "Total Revenue", "COGS", "Gross Profit"],
        ...summaryRows.map(r => [
          r.productName, r.unitType, r.totalQty,
          r.cashRevenue, r.mobileRevenue, r.creditRevenue,
          r.totalRevenue, r.cogs, r.totalRevenue - r.cogs,
        ]),
        ["TOTAL", "", "",
          summaryTotals.cashRevenue, summaryTotals.mobileRevenue, summaryTotals.creditRevenue,
          summaryTotals.totalRevenue, summaryTotals.cogs, summaryTotals.totalRevenue - summaryTotals.cogs,
        ],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Summary");
    } else {
      // Qty sheet
      const dayHdrs = matrixDays.map(d => format(parseISO(d), "EEE d MMM"));
      const qtyData = [
        ["Product", "Unit", ...dayHdrs, "Total Qty", "Total Revenue"],
        ...matrixProducts.map(p => [
          p.name, p.unitType,
          ...matrixDays.map(d => p.dayMap.get(d)?.qty ?? 0),
          p.totalQty, p.totalRev,
        ]),
        ["Daily Total", "", ...matrixColTotals.map(c => c.qty), matrixProducts.reduce((s, p) => s + p.totalQty, 0), summaryTotals.totalRevenue],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qtyData), "Qty by Day");

      // Revenue sheet
      const revData = [
        ["Product", "Unit", ...dayHdrs, "Total Revenue"],
        ...matrixProducts.map(p => [
          p.name, p.unitType,
          ...matrixDays.map(d => p.dayMap.get(d)?.revenue ?? 0),
          p.totalRev,
        ]),
        ["Daily Total", "", ...matrixColTotals.map(c => c.revenue), summaryTotals.totalRevenue],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(revData), "Revenue by Day");
    }

    // Raw data sheet (always included)
    const rawData: (string | number)[][] = [
      ["Date", "Payment Method", "Product", "Qty", "Unit", "Line Total", "Cost Price", "COGS"],
    ];
    for (const sale of sales) {
      for (const item of sale.sale_items ?? []) {
        if (!item.product) continue;
        const qty = itemQty(item);
        rawData.push([
          sale.sale_date, sale.payment_method, item.product.name,
          qty, item.product.unit_type, item.line_total,
          item.cost_price_at_sale, qty * item.cost_price_at_sale,
        ]);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rawData), "Raw Data");

    XLSX.writeFile(wb, `sales_${dateFrom}_to_${dateTo}.xlsx`);
  }

  // ── Labels ─────────────────────────────────────────────────
  const periodLabel = dateFrom === dateTo
    ? format(parseISO(dateFrom), "EEEE, d MMMM yyyy")
    : `${format(parseISO(dateFrom), "d MMM")} – ${format(parseISO(dateTo), "d MMM yyyy")}`;

  const grossProfit = summaryTotals.totalRevenue - summaryTotals.cogs;
  const margin = summaryTotals.totalRevenue > 0
    ? ((grossProfit / summaryTotals.totalRevenue) * 100).toFixed(1)
    : "0";

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Sales History" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* ── Controls ── */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          {/* Presets + custom range */}
          <div className="flex flex-wrap gap-1.5 items-center">
            {presets.map(p => (
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
                type="date" value={dateFrom} max={dateTo}
                onChange={e => { setDateFrom(e.target.value); setActivePreset("custom"); }}
                className="text-xs border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date" value={dateTo} min={dateFrom} max={today}
                onChange={e => { setDateTo(e.target.value); setActivePreset("custom"); }}
                className="text-xs border border-slate-200 rounded-md px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* View toggle + exports */}
          <div className="flex items-center gap-2">
            {isMultiDay && (
              <div className="flex gap-0.5 border border-slate-200 rounded-md p-0.5">
                <button
                  onClick={() => setViewMode("summary")}
                  className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${viewMode === "summary" ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"}`}
                >
                  <TableProperties className="h-3 w-3" /> Summary
                </button>
                <button
                  onClick={() => setViewMode("matrix")}
                  className={`px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 ${viewMode === "matrix" ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"}`}
                >
                  <Grid3X3 className="h-3 w-3" /> Matrix
                </button>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 text-xs h-8">
              <Download className="h-3 w-3" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportXLSX} className="gap-1.5 text-xs h-8">
              <FileSpreadsheet className="h-3 w-3" /> XLSX
            </Button>
          </div>
        </div>

        {/* ── KPI banner ── */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="bg-blue-50 border-blue-100">
              <CardContent className="p-3">
                <p className="text-xs font-medium text-blue-600">Total Revenue</p>
                <p className="text-xl font-bold text-blue-900">{formatCurrency(summaryTotals.totalRevenue)}</p>
                <p className="text-xs text-blue-600">{summaryTotals.transactions} transaction{summaryTotals.transactions !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>
            <Card className="bg-green-50 border-green-100">
              <CardContent className="p-3">
                <p className="text-xs font-medium text-green-600">Cash Collected</p>
                <p className="text-xl font-bold text-green-900">{formatCurrency(summaryTotals.cashRevenue)}</p>
                <p className="text-xs text-green-600">Mobile: {formatCurrency(summaryTotals.mobileRevenue)}</p>
              </CardContent>
            </Card>
            <Card className="bg-orange-50 border-orange-100">
              <CardContent className="p-3">
                <p className="text-xs font-medium text-orange-600">Credit Sales</p>
                <p className="text-xl font-bold text-orange-900">{formatCurrency(summaryTotals.creditRevenue)}</p>
                <p className="text-xs text-orange-600">Not yet collected</p>
              </CardContent>
            </Card>
            <Card className="bg-purple-50 border-purple-100">
              <CardContent className="p-3">
                <p className="text-xs font-medium text-purple-600">Gross Profit</p>
                <p className="text-xl font-bold text-purple-900">{formatCurrency(grossProfit)}</p>
                <p className="text-xs text-purple-600">{margin}% margin</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Main content ── */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : sales.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <p className="text-slate-500 text-sm">No sales recorded for {periodLabel}</p>
            </CardContent>
          </Card>
        ) : viewMode === "summary" ? (

          /* ════════════════ SUMMARY TABLE ════════════════ */
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{periodLabel}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-y">
                    <tr>
                      <th className="text-left   px-4 py-2.5 font-medium text-slate-500 text-xs">Product</th>
                      <th className="text-right  px-4 py-2.5 font-medium text-slate-500 text-xs">Qty Sold</th>
                      <th className="text-right  px-4 py-2.5 font-medium text-slate-500 text-xs">Cash</th>
                      <th className="text-right  px-4 py-2.5 font-medium text-slate-500 text-xs">Mobile</th>
                      <th className="text-right  px-4 py-2.5 font-medium text-slate-500 text-xs">Credit</th>
                      <th className="text-right  px-4 py-2.5 font-medium text-slate-500 text-xs">Revenue</th>
                      <th className="text-right  px-4 py-2.5 font-medium text-slate-500 text-xs">COGS</th>
                      <th className="text-right  px-4 py-2.5 font-medium text-slate-500 text-xs">Gross Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {summaryRows.map(row => {
                      const gp = row.totalRevenue - row.cogs;
                      return (
                        <tr key={row.productId} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium">{row.productName}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{fmtQty(row.totalQty, row.unitType)}</td>
                          <td className="px-4 py-2.5 text-right text-green-700">
                            {row.cashRevenue > 0 ? formatCurrency(row.cashRevenue) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-purple-700">
                            {row.mobileRevenue > 0 ? formatCurrency(row.mobileRevenue) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right text-orange-700">
                            {row.creditRevenue > 0 ? formatCurrency(row.creditRevenue) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(row.totalRevenue)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-500">{formatCurrency(row.cogs)}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${gp >= 0 ? "text-green-700" : "text-red-600"}`}>
                            {formatCurrency(gp)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                    <tr className="font-semibold text-sm">
                      <td className="px-4 py-2.5">TOTAL</td>
                      <td className="px-4 py-2.5 text-right text-slate-400 text-xs">—</td>
                      <td className="px-4 py-2.5 text-right text-green-700">{formatCurrency(summaryTotals.cashRevenue)}</td>
                      <td className="px-4 py-2.5 text-right text-purple-700">{formatCurrency(summaryTotals.mobileRevenue)}</td>
                      <td className="px-4 py-2.5 text-right text-orange-700">{formatCurrency(summaryTotals.creditRevenue)}</td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(summaryTotals.totalRevenue)}</td>
                      <td className="px-4 py-2.5 text-right">{formatCurrency(summaryTotals.cogs)}</td>
                      <td className={`px-4 py-2.5 text-right ${grossProfit >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {formatCurrency(grossProfit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

        ) : (

          /* ════════════════ MATRIX TABLE ════════════════ */
          <Card>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <p className="text-sm font-semibold text-slate-700">{periodLabel}</p>
                <p className="text-xs text-slate-400">{daySpan} days · {matrixProducts.length} products</p>
              </div>
              {/* Metric toggle */}
              <div className="flex gap-0.5 border border-slate-200 rounded-md p-0.5">
                {(["qty", "revenue", "both"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMatrixMetric(m)}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${
                      matrixMetric === m ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {m === "both" ? "Qty + Rev" : m === "qty" ? "Qty" : "Revenue"}
                  </button>
                ))}
              </div>
            </div>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      {/* Sticky product column */}
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 sticky left-0 z-10 bg-slate-50 min-w-[170px] border-r border-slate-200">
                        Product
                      </th>
                      {matrixDays.map(day => (
                        <th key={day} className="text-center px-3 py-2 font-medium text-slate-500 min-w-[85px] border-r border-slate-100 last:border-r-0">
                          <div className="font-semibold">{format(parseISO(day), "EEE")}</div>
                          <div className="text-slate-400 font-normal text-[10px]">{format(parseISO(day), "d MMM")}</div>
                        </th>
                      ))}
                      {/* Sticky total column */}
                      <th className="text-right px-4 py-2.5 font-medium text-slate-600 sticky right-0 z-10 bg-slate-50 min-w-[110px] border-l border-slate-200">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {matrixProducts.map(prod => (
                      <tr key={prod.pid} className="group hover:bg-blue-50/30">
                        {/* Product name — sticky */}
                        <td className="px-4 py-2.5 sticky left-0 z-10 bg-white group-hover:bg-blue-50/30 border-r border-slate-200 font-medium text-slate-700">
                          {prod.name}
                          <span className="ml-1.5 text-slate-400 font-normal text-[10px]">({prod.unitType})</span>
                        </td>

                        {matrixDays.map(day => {
                          const cell = prod.dayMap.get(day);
                          const hasData = !!cell && cell.qty > 0;
                          return (
                            <td key={day} className="px-3 py-2.5 text-center border-r border-slate-100 last:border-r-0">
                              {hasData ? (
                                <div className="leading-tight">
                                  {(matrixMetric === "qty" || matrixMetric === "both") && (
                                    <div className="font-medium text-slate-700">{fmtQty(cell!.qty, prod.unitType)}</div>
                                  )}
                                  {(matrixMetric === "revenue" || matrixMetric === "both") && (
                                    <div className={matrixMetric === "both" ? "text-[10px] text-slate-400" : "font-medium text-slate-700"}>
                                      {formatCurrency(cell!.revenue)}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-200">—</span>
                              )}
                            </td>
                          );
                        })}

                        {/* Row total — sticky */}
                        <td className="px-4 py-2.5 text-right sticky right-0 z-10 bg-white group-hover:bg-blue-50/30 border-l border-slate-200 font-semibold">
                          {(matrixMetric === "qty" || matrixMetric === "both") && (
                            <div className="text-slate-700">{fmtQty(prod.totalQty, prod.unitType)}</div>
                          )}
                          {(matrixMetric === "revenue" || matrixMetric === "both") && (
                            <div className={matrixMetric === "both" ? "text-[10px] text-slate-400" : "text-slate-700"}>
                              {formatCurrency(prod.totalRev)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  {/* Column totals row */}
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                    <tr className="font-semibold">
                      <td className="px-4 py-2.5 text-slate-700 sticky left-0 z-10 bg-slate-50 border-r border-slate-200">
                        Daily Total
                      </td>
                      {matrixColTotals.map(col => (
                        <td key={col.day} className="px-3 py-2.5 text-center border-r border-slate-100 last:border-r-0">
                          {col.revenue > 0 ? (
                            <div className="leading-tight">
                              {(matrixMetric === "revenue" || matrixMetric === "both") && (
                                <div className="text-slate-700">{formatCurrency(col.revenue)}</div>
                              )}
                              {(matrixMetric === "qty" || matrixMetric === "both") && (
                                <div className="text-[10px] text-slate-400">×{col.qty}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right sticky right-0 z-10 bg-slate-50 border-l border-slate-200 text-slate-700">
                        {formatCurrency(summaryTotals.totalRevenue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
