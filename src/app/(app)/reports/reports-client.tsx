"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell,
} from "recharts";
import { format, subDays, eachDayOfInterval, parseISO } from "date-fns";
import { TrendingUp, DollarSign, BarChart3 } from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

interface SaleRecord {
  sale_date: string;
  total_amount: number;
  payment_method: string;
  items: { line_total: number; cost_price_at_sale: number; quantity_kg: number; quantity_units: number }[];
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
  line_total: number;
  cost_price_at_sale: number;
  product: { name: string; unit_type: string } | null;
}

export function ReportsClient({
  salesData, expenseData, productSalesData,
}: {
  salesData: SaleRecord[];
  expenseData: ExpenseRecord[];
  productSalesData: ProductSaleRecord[];
}) {
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));

  const filteredSales = useMemo(() =>
    salesData.filter(s => s.sale_date >= dateFrom && s.sale_date <= dateTo),
    [salesData, dateFrom, dateTo]
  );

  const filteredExpenses = useMemo(() =>
    expenseData.filter(e => e.expense_date >= dateFrom && e.expense_date <= dateTo),
    [expenseData, dateFrom, dateTo]
  );

  // Daily P&L chart data
  const dailyData = useMemo(() => {
    const days = eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) });
    return days.map((day) => {
      const dateStr = format(day, "yyyy-MM-dd");
      const daySales = filteredSales.filter(s => s.sale_date === dateStr);
      const dayExpenses = filteredExpenses.filter(e => e.expense_date === dateStr);
      const revenue = daySales.reduce((s, sale) => s + sale.total_amount, 0);
      const cogs = daySales.flatMap(s => s.items ?? []).reduce((s, item) => {
        const qty = (item.quantity_kg || 0) + (item.quantity_units || 0);
        return s + qty * (item.cost_price_at_sale || 0);
      }, 0);
      const expenses = dayExpenses.reduce((s, e) => s + e.amount, 0);
      return {
        date: format(day, "MMM d"),
        revenue: Math.round(revenue * 100) / 100,
        gross_profit: Math.round((revenue - cogs) * 100) / 100,
        net_profit: Math.round((revenue - cogs - expenses) * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
      };
    });
  }, [filteredSales, filteredExpenses, dateFrom, dateTo]);

  // KPIs
  const totalRevenue = filteredSales.reduce((s, sale) => s + sale.total_amount, 0);
  const totalCOGS = filteredSales.flatMap(s => s.items ?? []).reduce((s, item) => {
    const qty = (item.quantity_kg || 0) + (item.quantity_units || 0);
    return s + qty * (item.cost_price_at_sale || 0);
  }, 0);
  const totalExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const grossProfit = totalRevenue - totalCOGS;
  const netProfit = grossProfit - totalExpenses;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Product profitability
  const filteredProductSales = useMemo(() => {
    return productSalesData.filter(ps => {
      const sale = ps as unknown as { sale: { sale_date: string } };
      return sale.sale?.sale_date >= dateFrom && sale.sale?.sale_date <= dateTo;
    });
  }, [productSalesData, dateFrom, dateTo]);

  const productProfitability = useMemo(() => {
    const byProduct: Record<string, { name: string; revenue: number; cogs: number; qty: number }> = {};
    filteredProductSales.forEach((item) => {
      const p = item.product as { name: string; unit_type: string } | null;
      if (!p) return;
      if (!byProduct[item.product_id]) byProduct[item.product_id] = { name: p.name, revenue: 0, cogs: 0, qty: 0 };
      byProduct[item.product_id].revenue += item.line_total;
      const qty = (item.quantity_kg || 0) + (item.quantity_units || 0);
      byProduct[item.product_id].cogs += qty * (item.cost_price_at_sale || 0);
      byProduct[item.product_id].qty += qty;
    });
    return Object.values(byProduct)
      .map(p => ({ ...p, profit: p.revenue - p.cogs, margin: p.revenue > 0 ? ((p.revenue - p.cogs) / p.revenue) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filteredProductSales]);

  // Expense breakdown for pie chart
  const expenseByCategory = useMemo(() => {
    const cats: Record<string, number> = {};
    filteredExpenses.forEach(e => { cats[e.category] = (cats[e.category] ?? 0) + e.amount; });
    return Object.entries(cats).map(([name, value]) => ({ name: name.replace(/_/g, " "), value }));
  }, [filteredExpenses]);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Date range */}
      <div className="flex items-center gap-3 bg-white border rounded-lg p-3">
        <BarChart3 className="h-4 w-4 text-blue-500" />
        <Label className="text-sm">Period:</Label>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36 h-8" />
        <span className="text-muted-foreground text-sm">to</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36 h-8" />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Revenue", value: formatCurrency(totalRevenue), icon: DollarSign, color: "text-blue-600" },
          { label: "COGS", value: formatCurrency(totalCOGS), icon: TrendingUp, color: "text-slate-600" },
          { label: "Gross Profit", value: formatCurrency(grossProfit), icon: TrendingUp, color: grossProfit >= 0 ? "text-green-600" : "text-red-600" },
          { label: "Expenses", value: formatCurrency(totalExpenses), icon: TrendingUp, color: "text-amber-600" },
          { label: "Net Profit", value: formatCurrency(netProfit), icon: TrendingUp, color: netProfit >= 0 ? "text-green-700" : "text-red-700" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily P&L */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Daily Revenue vs Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₵${(v/1000).toFixed(1)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ borderRadius: "8px" }} />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} name="Revenue" />
                <Line type="monotone" dataKey="gross_profit" stroke="#10b981" strokeWidth={2} dot={false} name="Gross Profit" />
                <Line type="monotone" dataKey="net_profit" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Net Profit" />
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
                    <Pie data={expenseByCategory} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={false}>
                      {expenseByCategory.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {expenseByCategory.map((cat, i) => (
                    <div key={cat.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="capitalize">{cat.name}</span>
                      </span>
                      <span className="font-semibold">{formatCurrency(cat.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No expenses in period</p>
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
                    <td className={`py-2 text-right font-semibold ${p.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(p.profit)}
                    </td>
                    <td className={`py-2 text-right ${p.margin >= 20 ? "text-green-600" : p.margin >= 10 ? "text-amber-600" : "text-red-600"}`}>
                      {p.margin.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right text-slate-500">{p.qty.toFixed(2)}</td>
                  </tr>
                ))}
                {productProfitability.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No sales in this period</td></tr>
                )}
              </tbody>
              {productProfitability.length > 0 && (
                <tfoot className="border-t font-semibold">
                  <tr>
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right">{formatCurrency(totalRevenue)}</td>
                    <td className="py-2 text-right text-slate-500">{formatCurrency(totalCOGS)}</td>
                    <td className={`py-2 text-right ${grossProfit >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(grossProfit)}</td>
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
