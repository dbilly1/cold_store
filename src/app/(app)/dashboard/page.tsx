import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { DashboardCharts } from "./dashboard-charts";
import { DashboardSalesTable } from "./dashboard-sales-table";
import {
  TrendingUp, ShoppingCart, Package, AlertTriangle,
  DollarSign, Scale, Receipt, Banknote, Smartphone,
} from "lucide-react";
import { format, subDays } from "date-fns";

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");

  // Current user role
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();
  const role = profile?.role ?? "salesperson";
  const isSalesperson = role === "salesperson";

  // ── Queries ──────────────────────────────────
  const [
    { data: todaySales },
    { data: weekSales },
    { data: todayExpenses },
    { count: openAlertsCount },
    { data: lowStockProducts },
    { count: pendingAdjustments },
    // Full today sales for salesperson table
    { data: todaySalesFull },
  ] = await Promise.all([
    supabase
      .from("sales")
      .select("total_amount, payment_method, sale_items(quantity_kg, quantity_units, line_total, cost_price_at_sale)")
      .eq("sale_date", today)
      .eq("is_deleted", false),

    supabase
      .from("sales")
      .select("total_amount, sale_date")
      .gte("sale_date", weekAgo)
      .eq("is_deleted", false),

    supabase
      .from("expenses")
      .select("amount")
      .eq("expense_date", today),

    supabase
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),

    supabase
      .from("products")
      .select("id, name, current_stock_kg, current_stock_units, unit_type, low_stock_threshold")
      .eq("is_active", true)
      .filter("current_stock_kg", "lte", "low_stock_threshold")
      .limit(5),

    supabase
      .from("stock_adjustments")
      .select("*", { count: "exact", head: true })
      .eq("approval_status", "pending"),

    supabase
      .from("sales")
      .select(`
        id, created_at, total_amount, payment_method,
        items:sale_items(
          id, quantity_kg, quantity_units, quantity_boxes, line_total,
          product:products(name, unit_type)
        )
      `)
      .eq("sale_date", today)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
  ]);

  // ── KPI Computations ─────────────────────────
  const todayRevenue   = todaySales?.reduce((s, s2) => s + s2.total_amount, 0) ?? 0;
  const todayCash      = todaySales?.filter(s => s.payment_method === "cash").reduce((s, s2) => s + s2.total_amount, 0) ?? 0;
  const todayMobile    = todaySales?.filter(s => s.payment_method === "mobile_money").reduce((s, s2) => s + s2.total_amount, 0) ?? 0;
  const todayCOGS      = todaySales?.flatMap(s => s.sale_items ?? []).reduce((s, item) => {
    const qty = (item.quantity_kg || 0) + (item.quantity_units || 0);
    return s + qty * (item.cost_price_at_sale || 0);
  }, 0) ?? 0;
  const todayExpenseTotal = todayExpenses?.reduce((s, e) => s + e.amount, 0) ?? 0;
  const todayGrossProfit  = todayRevenue - todayCOGS;
  const todayNetProfit    = todayGrossProfit - todayExpenseTotal;
  const todayTransactions = todaySales?.length ?? 0;

  // 7-day chart data (non-salesperson only)
  const weekByDay = weekSales?.reduce<Record<string, number>>((acc, sale) => {
    acc[sale.sale_date] = (acc[sale.sale_date] ?? 0) + sale.total_amount;
    return acc;
  }, {}) ?? {};
  const chartData = Array.from({ length: 7 }, (_, i) => {
    const date = format(subDays(new Date(), 6 - i), "yyyy-MM-dd");
    return { date: format(new Date(date), "EEE"), revenue: weekByDay[date] ?? 0 };
  });

  // ── Role-specific KPI cards ───────────────────
  const salespersonCards = [
    {
      title: "Today's Revenue",
      value: formatCurrency(todayRevenue),
      sub: `${todayTransactions} transaction${todayTransactions !== 1 ? "s" : ""}`,
      icon: DollarSign,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Cash Collected",
      value: formatCurrency(todayCash),
      sub: `${todayCash > 0 ? ((todayCash / todayRevenue) * 100).toFixed(0) : 0}% of revenue`,
      icon: Banknote,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      title: "Mobile Money",
      value: formatCurrency(todayMobile),
      sub: `${todayMobile > 0 ? ((todayMobile / todayRevenue) * 100).toFixed(0) : 0}% of revenue`,
      icon: Smartphone,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      title: "Expenses Today",
      value: formatCurrency(todayExpenseTotal),
      sub: "Recorded today",
      icon: Receipt,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
  ];

  const managerCards = [
    {
      title: "Today's Revenue",
      value: formatCurrency(todayRevenue),
      sub: `${todayTransactions} transaction${todayTransactions !== 1 ? "s" : ""}`,
      icon: DollarSign,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Gross Profit",
      value: formatCurrency(todayGrossProfit),
      sub: `Net: ${formatCurrency(todayNetProfit)}`,
      icon: TrendingUp,
      color: todayGrossProfit >= 0 ? "text-green-600" : "text-red-600",
      bg: todayGrossProfit >= 0 ? "bg-green-50" : "bg-red-50",
    },
    {
      title: "Cash Collected",
      value: formatCurrency(todayCash),
      sub: `Mobile: ${formatCurrency(todayMobile)}`,
      icon: ShoppingCart,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      title: "Expenses",
      value: formatCurrency(todayExpenseTotal),
      sub: "Today",
      icon: Receipt,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "Open Alerts",
      value: String(openAlertsCount ?? 0),
      sub: `${pendingAdjustments ?? 0} pending adjustment${(pendingAdjustments ?? 0) !== 1 ? "s" : ""}`,
      icon: AlertTriangle,
      color: (openAlertsCount ?? 0) > 0 ? "text-red-600" : "text-green-600",
      bg: (openAlertsCount ?? 0) > 0 ? "bg-red-50" : "bg-green-50",
    },
    {
      title: "Low Stock Items",
      value: String(lowStockProducts?.length ?? 0),
      sub: "Need restocking",
      icon: Package,
      color: (lowStockProducts?.length ?? 0) > 0 ? "text-amber-600" : "text-green-600",
      bg: (lowStockProducts?.length ?? 0) > 0 ? "bg-amber-50" : "bg-green-50",
    },
  ];

  const kpiCards = isSalesperson ? salespersonCards : managerCards;
  const gridCols = isSalesperson ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* KPI Cards */}
        <div className={`grid ${gridCols} gap-4`}>
          {kpiCards.map((card) => (
            <Card key={card.title}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{card.title}</p>
                    <p className="text-2xl font-bold mt-1">{card.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                  </div>
                  <div className={`h-10 w-10 rounded-lg ${card.bg} flex items-center justify-center flex-shrink-0`}>
                    <card.icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Bottom section — role-specific */}
        {isSalesperson ? (
          /* Salesperson: full-width today's sales table */
          <DashboardSalesTable sales={(todaySalesFull ?? []) as never} />
        ) : (
          /* Manager/Admin/Accountant: chart + low stock */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <DashboardCharts data={chartData} />
            </div>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Scale className="h-4 w-4 text-amber-500" />
                  Low Stock Items
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lowStockProducts && lowStockProducts.length > 0 ? (
                  <div className="space-y-3">
                    {lowStockProducts.map((product) => {
                      const stock = product.unit_type === "kg"
                        ? `${product.current_stock_kg.toFixed(2)} kg`
                        : `${product.current_stock_units} units`;
                      return (
                        <div key={product.id} className="flex items-center justify-between py-2 border-b last:border-0">
                          <div>
                            <p className="text-sm font-medium">{product.name}</p>
                            <p className="text-xs text-muted-foreground">Stock: {stock}</p>
                          </div>
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Low</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">All products well stocked</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}
