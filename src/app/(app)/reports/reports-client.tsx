"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { format, subDays, eachDayOfInterval, parseISO } from "date-fns";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Info,
} from "lucide-react";

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface SaleItem {
  line_total: number;
  cost_price_at_sale: number;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
}

interface SaleRecord {
  sale_date: string;
  total_amount: number;
  payment_method: string;
  items: SaleItem[];
}

interface ExpenseRecord {
  expense_date: string;
  amount: number;
  category: string;
}

interface ProductSaleRecord {
  product_id: string;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  line_total: number;
  cost_price_at_sale: number;
  product: { name: string; unit_type: string } | null;
}

interface CreditPaymentRecord {
  customer_id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
}

interface ReconRecord {
  reconciliation_date: string;
  cash_variance: number;
  mobile_variance: number;
  status: string;
}

// ─── COGS helper — works for kg, units, and boxes ────────────────────────────
function itemCOGS(item: SaleItem): number {
  // Only one of these will be non-zero per item (mutually exclusive unit types)
  const qty =
    (item.quantity_kg || 0) +
    (item.quantity_units || 0) +
    (item.quantity_boxes || 0);
  return qty * (item.cost_price_at_sale || 0);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReportsClient({
  salesData,
  expenseData,
  productSalesData,
  creditPaymentsData,
  reconData,
  dataStartDate,
}: {
  salesData: SaleRecord[];
  expenseData: ExpenseRecord[];
  productSalesData: ProductSaleRecord[];
  creditPaymentsData: CreditPaymentRecord[];
  reconData: ReconRecord[];
  dataStartDate: string;
}) {
  const [dateFrom, setDateFrom] = useState(
    format(subDays(new Date(), 30), "yyyy-MM-dd"),
  );
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const beyondWindow = dateFrom < dataStartDate;

  // ── Filtered datasets ──────────────────────────────────────────────────────
  const filteredSales = useMemo(
    () => salesData.filter((s) => s.sale_date >= dateFrom && s.sale_date <= dateTo),
    [salesData, dateFrom, dateTo],
  );

  const filteredExpenses = useMemo(
    () => expenseData.filter((e) => e.expense_date >= dateFrom && e.expense_date <= dateTo),
    [expenseData, dateFrom, dateTo],
  );

  const filteredRecons = useMemo(
    () =>
      reconData.filter(
        (r) => r.reconciliation_date >= dateFrom && r.reconciliation_date <= dateTo,
      ),
    [reconData, dateFrom, dateTo],
  );

  // ── KPIs ───────────────────────────────────────────────────────────────────

  // Revenue split
  const collectedRevenue = filteredSales
    .filter((s) => s.payment_method !== "credit")
    .reduce((s, sale) => s + sale.total_amount, 0);
  const creditRevenue = filteredSales
    .filter((s) => s.payment_method === "credit")
    .reduce((s, sale) => s + sale.total_amount, 0);
  const totalRevenue = collectedRevenue + creditRevenue;

  // COGS (fixed — includes boxes)
  const totalCOGS = filteredSales
    .flatMap((s) => s.items ?? [])
    .reduce((s, item) => s + itemCOGS(item), 0);

  const totalExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const grossProfit = totalRevenue - totalCOGS;
  const netProfit = grossProfit - totalExpenses;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Outstanding credit (all-time within data window — balance sheet figure)
  const allTimeCreditSales = salesData
    .filter((s) => s.payment_method === "credit")
    .reduce((s, sale) => s + sale.total_amount, 0);
  const allTimeCreditPaid = creditPaymentsData.reduce((s, p) => s + p.amount, 0);
  const creditOutstanding = allTimeCreditSales - allTimeCreditPaid;

  // Reconciliation summary
  const totalCashVariance = filteredRecons.reduce(
    (s, r) => s + (r.cash_variance || 0),
    0,
  );
  const totalMobileVariance = filteredRecons.reduce(
    (s, r) => s + (r.mobile_variance || 0),
    0,
  );
  const flaggedCount = filteredRecons.filter((r) => r.status === "flagged").length;
  const balancedCount = filteredRecons.filter((r) => r.status === "balanced").length;

  // ── Daily chart data ───────────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    let days: Date[] = [];
    try {
      days = eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) });
    } catch {
      return [];
    }
    return days.map((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      const daySales = filteredSales.filter((s) => s.sale_date === dateStr);
      const dayExpenses = filteredExpenses.filter((e) => e.expense_date === dateStr);
      const revenue = daySales.reduce((s, sale) => s + sale.total_amount, 0);
      const cash = daySales
        .filter((s) => s.payment_method === "cash")
        .reduce((s, sale) => s + sale.total_amount, 0);
      const mobile = daySales
        .filter((s) => s.payment_method === "mobile_money")
        .reduce((s, sale) => s + sale.total_amount, 0);
      const credit = daySales
        .filter((s) => s.payment_method === "credit")
        .reduce((s, sale) => s + sale.total_amount, 0);
      const cogs = daySales
        .flatMap((s) => s.items ?? [])
        .reduce((s, item) => s + itemCOGS(item), 0);
      const expenses = dayExpenses.reduce((s, e) => s + e.amount, 0);
      return {
        date: format(day, "MMM d"),
        revenue: Math.round(revenue * 100) / 100,
        gross_profit: Math.round((revenue - cogs) * 100) / 100,
        net_profit: Math.round((revenue - cogs - expenses) * 100) / 100,
        cash: Math.round(cash * 100) / 100,
        mobile: Math.round(mobile * 100) / 100,
        credit: Math.round(credit * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
      };
    });
  }, [filteredSales, filteredExpenses, dateFrom, dateTo]);

  // ── Product profitability ──────────────────────────────────────────────────
  const filteredProductSales = useMemo(() => {
    return productSalesData.filter((ps) => {
      const s = ps as unknown as { sale: { sale_date: string; payment_method: string } };
      return s.sale?.sale_date >= dateFrom && s.sale?.sale_date <= dateTo;
    });
  }, [productSalesData, dateFrom, dateTo]);

  const productProfitability = useMemo(() => {
    const byProduct: Record<
      string,
      { name: string; revenue: number; cogs: number; qty: number }
    > = {};
    filteredProductSales.forEach((item) => {
      const p = item.product as { name: string; unit_type: string } | null;
      if (!p) return;
      if (!byProduct[item.product_id])
        byProduct[item.product_id] = { name: p.name, revenue: 0, cogs: 0, qty: 0 };
      byProduct[item.product_id].revenue += item.line_total;
      byProduct[item.product_id].cogs += itemCOGS(item);
      byProduct[item.product_id].qty +=
        (item.quantity_kg || 0) +
        (item.quantity_units || 0) +
        (item.quantity_boxes || 0);
    });
    return Object.values(byProduct)
      .map((p) => ({
        ...p,
        profit: p.revenue - p.cogs,
        margin: p.revenue > 0 ? ((p.revenue - p.cogs) / p.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredProductSales]);

  // ── Expense by category ────────────────────────────────────────────────────
  const expenseByCategory = useMemo(() => {
    const cats: Record<string, number> = {};
    filteredExpenses.forEach(
      (e) => (cats[e.category] = (cats[e.category] ?? 0) + e.amount),
    );
    return Object.entries(cats).map(([name, value]) => ({
      name: name.replace(/_/g, " "),
      value,
    }));
  }, [filteredExpenses]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

      {/* Date range picker */}
      <div className="flex items-center gap-3 bg-white border rounded-lg p-3 flex-wrap">
        <BarChart3 className="h-4 w-4 text-blue-500 flex-shrink-0" />
        <Label className="text-sm">Period:</Label>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-36 h-8"
        />
        <span className="text-muted-foreground text-sm">to</span>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-36 h-8"
        />
        {beyondWindow && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600 ml-2">
            <Info className="h-3.5 w-3.5" />
            Data only available from {formatDate(dataStartDate)} — results may be incomplete
          </span>
        )}
      </div>

      {/* KPI Row — 6 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Total Revenue */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Revenue</p>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(totalRevenue)}</p>
            <p className="text-xs text-muted-foreground mt-1">incl. credit sales</p>
          </CardContent>
        </Card>

        {/* Cash Collected */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Cash Collected</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(collectedRevenue)}</p>
            <p className="text-xs text-muted-foreground mt-1">cash + mobile only</p>
          </CardContent>
        </Card>

        {/* Credit Sales */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Credit Sales</p>
            <p className="text-xl font-bold text-purple-600">{formatCurrency(creditRevenue)}</p>
            <p className="text-xs text-amber-600 mt-1 font-medium">
              {formatCurrency(creditOutstanding)} outstanding
            </p>
          </CardContent>
        </Card>

        {/* Gross Profit + Margin */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Gross Profit</p>
            <p className={`text-xl font-bold ${grossProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(grossProfit)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{grossMargin.toFixed(1)}% margin</p>
          </CardContent>
        </Card>

        {/* Expenses */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Expenses</p>
            <p className="text-xl font-bold text-amber-600">{formatCurrency(totalExpenses)}</p>
            <p className="text-xs text-muted-foreground mt-1">operating costs</p>
          </CardContent>
        </Card>

        {/* Net Profit */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Net Profit</p>
            <p className={`text-xl font-bold ${netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
              {formatCurrency(netProfit)}
            </p>
            {netProfit >= 0 ? (
              <TrendingUp className="h-3 w-3 text-green-500 mt-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500 mt-1" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: Daily P&L + Expense Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Revenue vs Profit */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Daily Revenue vs Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `₵${(v / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  formatter={(v: number) => formatCurrency(v)}
                  contentStyle={{ borderRadius: "8px" }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="Revenue"
                />
                <Line
                  type="monotone"
                  dataKey="gross_profit"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  name="Gross Profit"
                />
                <Line
                  type="monotone"
                  dataKey="net_profit"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  dot={false}
                  name="Net Profit"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Expense Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseByCategory.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={expenseByCategory}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="value"
                      label={false}
                    >
                      {expenseByCategory.map((_, index) => (
                        <Cell
                          key={index}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {expenseByCategory.map((cat, i) => (
                    <div
                      key={cat.name}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="flex items-center gap-1">
                        <span
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="capitalize">{cat.name}</span>
                      </span>
                      <span className="font-semibold">{formatCurrency(cat.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No expenses in period
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Payment Method Breakdown + Reconciliation Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Payment Method Breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Revenue by Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `₵${(v / 1000).toFixed(1)}k`}
                />
                <Tooltip
                  formatter={(v: number) => formatCurrency(v)}
                  contentStyle={{ borderRadius: "8px" }}
                />
                <Legend />
                <Bar dataKey="cash" stackId="a" fill="#10b981" name="Cash" radius={[0, 0, 0, 0]} />
                <Bar dataKey="mobile" stackId="a" fill="#3b82f6" name="Mobile Money" radius={[0, 0, 0, 0]} />
                <Bar dataKey="credit" stackId="a" fill="#8b5cf6" name="Credit" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Reconciliation Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Reconciliation Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {filteredRecons.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No reconciliations in period
              </p>
            ) : (
              <>
                {/* Session counts */}
                <div className="flex gap-3">
                  <div className="flex-1 bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-green-600">{balancedCount}</p>
                    <p className="text-xs text-green-700">Balanced</p>
                  </div>
                  <div className="flex-1 bg-red-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-red-600">{flaggedCount}</p>
                    <p className="text-xs text-red-700">Flagged</p>
                  </div>
                </div>

                {/* Variance totals */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Cash variance</span>
                    <span
                      className={`font-semibold ${
                        totalCashVariance > 0
                          ? "text-amber-600"
                          : totalCashVariance < 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {totalCashVariance >= 0 ? "+" : ""}
                      {formatCurrency(totalCashVariance)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Mobile variance</span>
                    <span
                      className={`font-semibold ${
                        totalMobileVariance > 0
                          ? "text-amber-600"
                          : totalMobileVariance < 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {totalMobileVariance >= 0 ? "+" : ""}
                      {formatCurrency(totalMobileVariance)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-t pt-2">
                    <span className="text-slate-700 font-medium">Net variance</span>
                    <span
                      className={`font-bold ${
                        totalCashVariance + totalMobileVariance > 0
                          ? "text-amber-600"
                          : totalCashVariance + totalMobileVariance < 0
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {totalCashVariance + totalMobileVariance >= 0 ? "+" : ""}
                      {formatCurrency(totalCashVariance + totalMobileVariance)}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-400">
                  Positive = surplus collected · Negative = shortfall
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Product Profitability Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Product Profitability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left py-2 text-slate-500 font-medium">Product</th>
                  <th className="text-right py-2 text-slate-500 font-medium">Revenue</th>
                  <th className="text-right py-2 text-slate-500 font-medium">COGS</th>
                  <th className="text-right py-2 text-slate-500 font-medium">Gross Profit</th>
                  <th className="text-right py-2 text-slate-500 font-medium">Margin %</th>
                  <th className="text-right py-2 text-slate-500 font-medium">Qty Sold</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {productProfitability.map((p) => (
                  <tr key={p.name} className="hover:bg-slate-50">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="py-2 text-right">{formatCurrency(p.revenue)}</td>
                    <td className="py-2 text-right text-slate-500">{formatCurrency(p.cogs)}</td>
                    <td
                      className={`py-2 text-right font-semibold ${
                        p.profit >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatCurrency(p.profit)}
                    </td>
                    <td
                      className={`py-2 text-right ${
                        p.margin >= 20
                          ? "text-green-600"
                          : p.margin >= 10
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      {p.margin.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right text-slate-500">
                      {p.qty % 1 === 0 ? p.qty.toFixed(0) : p.qty.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {productProfitability.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No sales in this period
                    </td>
                  </tr>
                )}
              </tbody>
              {productProfitability.length > 0 && (
                <tfoot className="border-t font-semibold">
                  <tr>
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right">{formatCurrency(totalRevenue)}</td>
                    <td className="py-2 text-right text-slate-500">
                      {formatCurrency(totalCOGS)}
                    </td>
                    <td
                      className={`py-2 text-right ${
                        grossProfit >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatCurrency(grossProfit)}
                    </td>
                    <td className="py-2 text-right">{grossMargin.toFixed(1)}%</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
