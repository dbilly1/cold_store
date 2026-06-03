"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/hooks/use-profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
  eachDayOfInterval,
  differenceInDays,
} from "date-fns";
import {
  ArrowLeft,
  Package,
  TrendingUp,
  AlertTriangle,
  Clock,
  DollarSign,
  BarChart2,
} from "lucide-react";
import { TablePagination } from "@/components/ui/table-pagination";
import type { UnitType } from "@/types/database";

// ── Types ─────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  unit_type: UnitType;
  units_per_box: number | null;
  current_stock_kg: number;
  current_stock_units: number;
  current_stock_boxes: number;
  weighted_avg_cost: number;
  selling_price: number;
  low_stock_threshold: number;
  variance_threshold_pct: number;
  is_active: boolean;
  created_at: string;
  category: { id: string; name: string } | null;
}

interface RestockRow {
  id: string;
  created_at: string;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  cost_price_per_unit: number;
  cost_price_per_box: number | null;
  units_per_box: number | null;
  supplier: string | null;
  notes: string | null;
}

// sale may come back as object or array depending on Supabase version
type SaleRef = { id: string; sale_date: string; payment_method: string; is_deleted: boolean };

interface SaleItemData {
  line_total: number;
  unit_price: number;
  discount_amount: number;
  cost_price_at_sale: number;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  sale: SaleRef | SaleRef[] | null;
}

type RangePreset = "this_week" | "last_week" | "this_month" | "last_month" | "custom";

// ── Helpers ───────────────────────────────────────────────────

/** Normalise the sale field whether Supabase returns object or array */
function getSale(item: SaleItemData): SaleRef | null {
  if (!item.sale) return null;
  if (Array.isArray(item.sale)) return item.sale[0] ?? null;
  return item.sale;
}

function stockQty(p: Product): number {
  if (p.unit_type === "kg")    return p.current_stock_kg;
  if (p.unit_type === "units") return p.current_stock_units;
  return p.current_stock_boxes;
}

function stockDisplay(p: Product): string {
  if (p.unit_type === "kg")    return `${Number(p.current_stock_kg).toFixed(3)} kg`;
  if (p.unit_type === "units") return `${Number(p.current_stock_units)} units`;
  return `${Number(p.current_stock_boxes)} boxes`;
}

function isLowStock(p: Product): boolean {
  return stockQty(p) <= p.low_stock_threshold;
}

function itemQty(item: SaleItemData): number {
  if (!item.unit_price || item.unit_price === 0)
    return item.quantity_kg || item.quantity_units || item.quantity_boxes || 0;
  return (item.line_total + (item.discount_amount || 0)) / item.unit_price;
}

function itemCOGS(item: SaleItemData): number {
  if (!item.unit_price || item.unit_price === 0) return 0;
  const totalQty = (item.line_total + (item.discount_amount || 0)) / item.unit_price;
  return totalQty * (item.cost_price_at_sale || 0);
}

function getPresetDates(preset: RangePreset): { from: string; to: string } {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  switch (preset) {
    case "this_week":
      return {
        from: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        to: todayStr,
      };
    case "last_week":
      return {
        from: format(startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }), "yyyy-MM-dd"),
        to: format(endOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    case "this_month":
      return {
        from: format(startOfMonth(today), "yyyy-MM-dd"),
        to: todayStr,
      };
    case "last_month":
      return {
        from: format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd"),
        to: format(endOfMonth(subMonths(today, 1)), "yyyy-MM-dd"),
      };
    default:
      return { from: todayStr, to: todayStr };
  }
}

function fmtQty(qty: number, unitType: UnitType): string {
  if (unitType === "kg")    return `${qty % 1 === 0 ? qty : qty.toFixed(3)} kg`;
  if (unitType === "units") return `${Math.round(qty)} units`;
  return `${qty % 1 === 0 ? qty : qty.toFixed(2)} boxes`;
}

function restockQty(row: RestockRow, unitType: UnitType): string {
  // Always show boxes first; fall back to primary unit for older records
  if (row.quantity_boxes && row.quantity_boxes > 0)
    return `${row.quantity_boxes} box${row.quantity_boxes !== 1 ? "es" : ""}`;
  if (unitType === "kg"    && row.quantity_kg    > 0) return `${row.quantity_kg.toFixed(3)} kg`;
  if (unitType === "units" && row.quantity_units > 0) return `${Math.round(row.quantity_units)} units`;
  return "—";
}

function paymentBadge(method: string) {
  if (method === "cash")
    return <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50">Cash</Badge>;
  if (method === "mobile_money")
    return <Badge variant="outline" className="text-xs text-blue-700 border-blue-300 bg-blue-50">Mobile</Badge>;
  if (method === "credit")
    return <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">Credit</Badge>;
  return <Badge variant="outline" className="text-xs">{method}</Badge>;
}

// ── Component ─────────────────────────────────────────────────

export function ProductDetailClient({
  product,
  restockHistory,
  salesData,
}: {
  product: Product;
  restockHistory: RestockRow[];
  salesData: SaleItemData[];
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "supervisor";

  const [preset, setPreset]           = useState<RangePreset>("this_month");
  const [customFrom, setCustomFrom]   = useState("");
  const [customTo, setCustomTo]       = useState("");
  const [chartType, setChartType]     = useState<"line" | "bar">("line");
  const [salesPage, setSalesPage]     = useState(0);
  const [salesPageSize, setSalesPageSize] = useState(10);

  // ── Dates ─────────────────────────────────────────────────
  const { dateFrom, dateTo } = useMemo(() => {
    if (preset === "custom") return { dateFrom: customFrom, dateTo: customTo };
    const { from, to } = getPresetDates(preset);
    return { dateFrom: from, dateTo: to };
  }, [preset, customFrom, customTo]);

  // ── All sales sorted newest first (for recent transactions) ─
  const sortedSales = useMemo(
    () =>
      [...salesData].sort((a, b) => {
        const da = getSale(a)?.sale_date ?? "";
        const db = getSale(b)?.sale_date ?? "";
        return db.localeCompare(da);
      }),
    [salesData],
  );

  // ── Sales filtered to selected period (for chart + summary) ─
  const filteredSales = useMemo(() => {
    if (!dateFrom || !dateTo) return [];
    return sortedSales.filter((item) => {
      const d = getSale(item)?.sale_date ?? "";
      return d >= dateFrom && d <= dateTo;
    });
  }, [sortedSales, dateFrom, dateTo]);

  // ── Period summary cards ───────────────────────────────────
  const summary = useMemo(() => {
    const revenue = filteredSales.reduce((s, i) => s + i.line_total, 0);
    const cogs    = filteredSales.reduce((s, i) => s + itemCOGS(i), 0);
    return { revenue, cogs, profit: revenue - cogs };
  }, [filteredSales]);

  // ── Chart data (one point per day in range) ────────────────
  const chartData = useMemo(() => {
    if (!dateFrom || !dateTo) return [];
    const span = differenceInDays(parseISO(dateTo), parseISO(dateFrom));
    if (span < 0 || span > 366) return [];

    const byDate = new Map<string, number>();
    filteredSales.forEach((item) => {
      const d = getSale(item)?.sale_date;
      if (d) byDate.set(d, (byDate.get(d) ?? 0) + itemQty(item));
    });

    const useLongLabel = span <= 14;
    return eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) }).map((day) => {
      const ds = format(day, "yyyy-MM-dd");
      return {
        date: ds,
        label: format(day, useLongLabel ? "EEE d MMM" : "d MMM"),
        qty: byDate.get(ds) ?? 0,
      };
    });
  }, [filteredSales, dateFrom, dateTo]);

  // ── Key metrics ───────────────────────────────────────────
  const currentStockQty = stockQty(product);
  const stockValue      = currentStockQty * product.weighted_avg_cost;
  const margin =
    product.selling_price > 0
      ? ((product.selling_price - product.weighted_avg_cost) / product.selling_price) * 100
      : 0;
  const lastRestock       = restockHistory[0];
  const daysSinceRestock  = lastRestock
    ? differenceInDays(new Date(), parseISO(lastRestock.created_at))
    : null;
  const low = isLowStock(product);

  const presets: { label: string; value: RangePreset }[] = [
    { label: "This Week",  value: "this_week"  },
    { label: "Last Week",  value: "last_week"  },
    { label: "This Month", value: "this_month" },
    { label: "Last Month", value: "last_month" },
    { label: "Custom",     value: "custom"     },
  ];

  const unitLabel = product.unit_type === "kg" ? "kg"
    : product.unit_type === "units" ? "units"
    : "boxes";

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="text-slate-500 hover:text-slate-700 -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-800">{product.name}</h1>
              {low && (
                <Badge variant="destructive" className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Low Stock
                </Badge>
              )}
              {!product.is_active && (
                <Badge variant="secondary" className="text-xs">Inactive</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
              {product.category && <span>{product.category.name}</span>}
              {product.category && <span>·</span>}
              <span className="capitalize">{product.unit_type}</span>
              {product.units_per_box && (
                <><span>·</span><span>{product.units_per_box} units/box</span></>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Key Metrics Row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-blue-500" />
              <p className="text-xs text-slate-500">Current Stock</p>
            </div>
            <p className={`text-xl font-bold ${low ? "text-red-600" : "text-slate-800"}`}>
              {stockDisplay(product)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              threshold: {product.low_stock_threshold} {unitLabel}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              <p className="text-xs text-slate-500">Stock Value</p>
            </div>
            <p className="text-xl font-bold text-slate-800">{formatCurrency(stockValue)}</p>
            <p className="text-xs text-slate-400 mt-0.5">at avg cost</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-slate-400" />
              <p className="text-xs text-slate-500">Selling Price</p>
            </div>
            <p className="text-xl font-bold text-slate-800">{formatCurrency(product.selling_price)}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              WAC: {formatCurrency(product.weighted_avg_cost)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <p className="text-xs text-slate-500">Margin</p>
            </div>
            <p className="text-xl font-bold text-slate-800">{margin.toFixed(1)}%</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {formatCurrency(product.selling_price - product.weighted_avg_cost)} / {unitLabel}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-amber-500" />
              <p className="text-xs text-slate-500">Last Restock</p>
            </div>
            {daysSinceRestock !== null ? (
              <>
                <p className="text-xl font-bold text-slate-800">{daysSinceRestock}d ago</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {format(parseISO(lastRestock.created_at), "d MMM yyyy")}
                </p>
              </>
            ) : (
              <p className="text-xl font-bold text-slate-400">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 70 / 30 split ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[7fr_3fr] gap-6 pb-6">

        {/* ── Left 70%: Sales Performance + Recent Sales ── */}
        <div className="space-y-6 min-w-0">

          {/* Sales Performance */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart2 className="h-4 w-4 text-blue-500" />
                    Sales Performance
                  </CardTitle>
                  {/* Chart type toggle */}
                  <div className="flex items-center rounded-md border overflow-hidden">
                    <button
                      onClick={() => setChartType("line")}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                        chartType === "line"
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      Line
                    </button>
                    <button
                      onClick={() => setChartType("bar")}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors border-l ${
                        chartType === "bar"
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      Bar
                    </button>
                  </div>
                </div>
                {/* Range picker */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {presets.map((p) => (
                    <Button
                      key={p.value}
                      size="sm"
                      variant={preset === p.value ? "default" : "outline"}
                      className="h-7 text-xs px-3"
                      onClick={() => setPreset(p.value)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
              {preset === "custom" && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Input
                    type="date"
                    className="h-8 text-sm w-36"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                  <span className="text-slate-400 text-sm">to</span>
                  <Input
                    type="date"
                    className="h-8 text-sm w-36"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              )}
            </CardHeader>

            <CardContent>
              {/* Period summary */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded-lg bg-slate-50 border p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Revenue</p>
                  <p className="text-lg font-bold text-slate-800">{formatCurrency(summary.revenue)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 border p-3">
                  <p className="text-xs text-slate-500 mb-0.5">COGS</p>
                  <p className="text-lg font-bold text-slate-800">{formatCurrency(summary.cogs)}</p>
                </div>
                <div className={`rounded-lg border p-3 ${summary.profit >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                  <p className="text-xs text-slate-500 mb-0.5">Gross Profit</p>
                  <p className={`text-lg font-bold ${summary.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {formatCurrency(summary.profit)}
                  </p>
                </div>
              </div>

              {/* Chart */}
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  {chartType === "line" ? (
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `${v} ${unitLabel}`} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} formatter={(value: number) => [fmtQty(value, product.unit_type), "Sold"]} labelStyle={{ color: "#475569", fontWeight: 600 }} />
                      <Line type="monotone" dataKey="qty" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  ) : (
                    <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `${v} ${unitLabel}`} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} formatter={(value: number) => [fmtQty(value, product.unit_type), "Sold"]} labelStyle={{ color: "#475569", fontWeight: 600 }} cursor={{ fill: "#f1f5f9" }} />
                      <Bar dataKey="qty" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">
                  No sales data for this period
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Sales */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent Sales</CardTitle>
              <p className="text-xs text-slate-500">Last 20 transactions involving this product</p>
            </CardHeader>
            <CardContent className="p-0">
              {sortedSales.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-y">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Date</th>
                          <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Method</th>
                          <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Qty</th>
                          <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sortedSales
                          .slice(salesPage * salesPageSize, (salesPage + 1) * salesPageSize)
                          .map((item, i) => {
                            const sale = getSale(item);
                            return (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 text-slate-600">
                                  {sale ? format(parseISO(sale.sale_date), "d MMM yyyy") : "—"}
                                </td>
                                <td className="px-4 py-2.5">
                                  {sale ? paymentBadge(sale.payment_method) : "—"}
                                </td>
                                <td className="px-4 py-2.5 text-right text-slate-700">
                                  {fmtQty(itemQty(item), product.unit_type)}
                                </td>
                                <td className="px-4 py-2.5 text-right font-medium">
                                  {formatCurrency(item.line_total)}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <TablePagination
                    total={sortedSales.length}
                    page={salesPage}
                    pageSize={salesPageSize}
                    onPageChange={setSalesPage}
                    onPageSizeChange={(s) => { setSalesPageSize(s); setSalesPage(0); }}
                    pageSizeOptions={[10, 20, 50]}
                    rowLabel="Sales"
                  />
                </>
              ) : (
                <div className="py-10 text-center text-slate-400 text-sm">No sales in the last year</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right 30%: Restock History ── */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Restock History</CardTitle>
            <p className="text-xs text-slate-500">All procurement events, newest first</p>
          </CardHeader>
          <CardContent className="p-0">
            {restockHistory.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-y">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Date</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Qty</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">Cost / Box</th>
                      <th className="text-right px-4 py-2.5 font-medium text-slate-500 text-xs">UPB</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Supplier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {restockHistory.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                          {format(parseISO(row.created_at), "d MMM yy")}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700 whitespace-nowrap">
                          {restockQty(row, product.unit_type)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {row.cost_price_per_box != null
                            ? <div className="font-medium">{formatCurrency(row.cost_price_per_box)}</div>
                            : <div className="text-slate-400">—</div>}
                          <div className="text-xs text-slate-400">
                            {formatCurrency(row.cost_price_per_unit)}/unit
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600">
                          {row.units_per_box ?? <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-[100px] truncate">
                          {row.supplier ?? <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center text-slate-400 text-sm">No restock records found</div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
