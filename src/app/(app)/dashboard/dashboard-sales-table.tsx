"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ShoppingCart } from "lucide-react";

interface SaleRow {
  id: string;
  created_at: string;
  total_amount: number;
  payment_method: string;
  items: Array<{
    id: string;
    quantity_kg: number;
    quantity_units: number;
    quantity_boxes: number;
    line_total: number;
    product: { name: string; unit_type: string } | null;
  }>;
}

export function DashboardSalesTable({ sales }: { sales: SaleRow[] }) {
  if (sales.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-500" />
            Today&apos;s Sales
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">No sales recorded today</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-500" />
            Today&apos;s Sales
          </CardTitle>
          <span className="text-sm text-muted-foreground">{sales.length} transaction{sales.length !== 1 ? "s" : ""}</span>
        </div>
        <p className="text-2xl font-bold">
          {formatCurrency(sales.reduce((s, r) => s + r.total_amount, 0))}
        </p>
      </CardHeader>

      <CardContent className="flex-1 overflow-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Time</th>
              <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Items</th>
              <th className="text-center px-4 py-2 font-medium text-slate-500 text-xs">Payment</th>
              <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {sales.map((sale) => (
              <tr key={sale.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                  {formatDateTime(sale.created_at).split(",")[1]?.trim() ?? formatDateTime(sale.created_at)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="space-y-0.5">
                    {sale.items?.map((item) => {
                      const p = item.product as { name: string; unit_type: string } | null;
                      const qtyStr = item.quantity_kg > 0
                        ? `${item.quantity_kg} kg`
                        : item.quantity_units > 0
                          ? `${item.quantity_units} units`
                          : `${item.quantity_boxes} boxes`;
                      return (
                        <p key={item.id} className="text-xs text-slate-600">
                          {p?.name ?? "—"}
                          <span className="text-slate-400 ml-1">· {qtyStr}</span>
                        </p>
                      );
                    })}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Badge variant={sale.payment_method === "cash" ? "secondary" : "outline"} className="text-xs">
                    {sale.payment_method === "cash" ? "Cash" : "MoMo"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right font-semibold">
                  {formatCurrency(sale.total_amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
