import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { DashboardCharts } from "./dashboard-charts";
import {
  TrendingUp, ShoppingCart, Package, AlertTriangle,
  DollarSign, Scale, Receipt, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { format, subDays } from "date-fns";

export default async function DashboardPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");

  // Today's sales
  const { data: todaySales } = await supabase
    .from("sales")
    .select("total_amount, payment_method, sale_items(quantity_kg, quantity_units, line_total, cost_price_at_sale)")
    .eq("sale_date", today)
    .eq("is_deleted", false);

  // This week's sales
  const { data: weekSales } = await supabase
    .from("sales")
    .select("total_amount, sale_date")
    .gte("sale_date", weekAgo)
    .eq("is_deleted", false);

  // Today's expenses
  const { data: todayExpenses } = await supabase
    .from("expenses")
    .select("amount")
    .eq("expense_date", today);

  // Alerts
  const { count: openAlertsCount } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  // Low stock products
  const { data: lowStockProducts } = await supabase
    .from("products")
    .select("id, name, current_stock_kg, current_stock_units, unit_type, low_stock_threshold")
    .eq("is_active", true)
    .filter("current_stock_kg", "lte", "low_stock_threshold")
    .limit(5);

  // Pending adjustments
  const { count: pendingAdjustments } = await supabase
    .from("stock_adjustments")
    .select("*", { count: "exact", head: true })
    .eq("approval_status", "pending");

  // Compute KPIs
  const todayRevenue = todaySales?.reduce((s, sale) => s + sale.total_amount, 0) ?? 0;
  const todayCash = todaySales?.filter(s => s.payment_method === "cash").reduce((s, sale) => s + sale.total_amount, 0) ?? 0;
  const todayMobile = todaySales?.filter(s => s.payment_method === "mobile_money").reduce((s, sale) => s + sale.total_amount, 0) ?? 0;
  const todayCOGS = todaySales?.flatMap(s => s.sale_items ?? []).reduce((s, item) => {
    const qty = (item.quantity_kg || 0) + (item.quantity_units || 0);
    return s + qty * (item.cost_price_at_sale || 0);
  }, 0) ?? 0;
  const todayExpenseTotal = todayExpenses?.reduce((s, e) => s + e.amount, 0) ?? 0;
  const todayGrossProfit = todayRevenue - todayCOGS;
  const todayNetProfit = todayGrossProfit - todayExpenseTotal;
  const todayTransactions = todaySales?.length ?? 0;

  // Week revenue by day for chart
  const weekByDay = weekSales?.reduce<Record<string, number>>((acc, sale) => {
    acc[sale.sale_date] = (acc[sale.sale_date] ?? 0) + sale.total_amount;
    return acc;
  }, {}) ?? {};

  const chartData = Array.from({ length: 7 }, (_, i) => {
    const date = format(subDays(new Date(), 6 - i), "yyyy-MM-dd");
    return { date: format(new Date(date), "EEE"), revenue: weekByDay[date] ?? 0 };
  });

  const kpiCards = [
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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

        {/* Charts + Low Stock */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <DashboardCharts data={chartData} />
          </div>

          {/* Low Stock */}
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
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                          Low
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  All products well stocked
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
