"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils";
import {
  Pencil,
  Trash2,
  Layers,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
} from "lucide-react";
import type { ExistingSale } from "./sales-types";

interface SalesDrilldownProps {
  selectedDate: string;
  dayDetails: ExistingSale[];
  loadingDay: boolean;
  expandedBatches: Set<string>;
  profile: { role?: string } | null;
  onBack: () => void;
  onToggleBatch: (batchId: string) => void;
  onEdit: (sale: ExistingSale) => void;
  onDelete: (saleId: string) => void;
}

export function SalesDrilldown({
  selectedDate,
  dayDetails,
  loadingDay,
  expandedBatches,
  profile,
  onBack,
  onToggleBatch,
  onEdit,
  onDelete,
}: SalesDrilldownProps) {
  const canDelete =
    profile?.role === "supervisor" || profile?.role === "admin";

  const SaleTable = ({ sales }: { sales: ExistingSale[] }) => (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 border-b">
        <tr>
          <th className="text-left px-4 py-3 font-medium text-slate-600 w-24">
            Time
          </th>
          <th className="text-left px-4 py-3 font-medium text-slate-600">
            Items
          </th>
          <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">
            Qty
          </th>
          <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">
            Unit Price
          </th>
          <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">
            Amount
          </th>
          <th className="text-center px-4 py-3 font-medium text-slate-600 w-24">
            Payment
          </th>
          <th className="text-left px-4 py-3 font-medium text-slate-600 w-36">
            Recorded by
          </th>
          {canDelete && <th className="w-20" />}
        </tr>
      </thead>
      <tbody className="divide-y">
        {sales.map((sale) => (
          <tr key={sale.id} className="hover:bg-slate-50">
            <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
              {formatDateTime(sale.created_at).split(",")[1]?.trim() ??
                formatDateTime(sale.created_at)}
            </td>
            <td className="px-4 py-3">
              <div className="space-y-1">
                {sale.items?.map((item) => {
                  const p = item.product as {
                    name: string;
                    unit_type: string;
                  } | null;
                  return (
                    <p key={item.id} className="text-xs">
                      {p?.name ?? "—"}
                    </p>
                  );
                })}
              </div>
            </td>
            <td className="px-4 py-3 text-right">
              <div className="space-y-1">
                {sale.items?.map((item) => {
                  const qtyStr =
                    item.quantity_kg > 0
                      ? `${item.quantity_kg} kg`
                      : item.quantity_units > 0
                      ? `${item.quantity_units} units`
                      : `${item.quantity_boxes} boxes`;
                  return (
                    <p key={item.id} className="text-xs text-slate-600">
                      {qtyStr}
                    </p>
                  );
                })}
              </div>
            </td>
            <td className="px-4 py-3 text-right">
              <div className="space-y-1">
                {sale.items?.map((item) => (
                  <p key={item.id} className="text-xs text-slate-600">
                    {formatCurrency(item.unit_price)}
                  </p>
                ))}
              </div>
            </td>
            <td className="px-4 py-3 text-right font-semibold">
              {formatCurrency(sale.total_amount)}
            </td>
            <td className="px-4 py-3 text-center">
              <Badge
                variant={
                  sale.payment_method === "cash" ? "secondary" : "outline"
                }
                className="text-xs"
              >
                {sale.payment_method === "cash"
                  ? "Cash"
                  : sale.payment_method === "mobile_money"
                  ? "MoMo"
                  : "Credit"}
              </Badge>
            </td>
            <td className="px-4 py-3 text-xs text-slate-500">
              {(sale.recorded_by_profile as { full_name: string } | null)
                ?.full_name ?? "—"}
            </td>
            {canDelete && (
              <td className="px-2 py-3">
                <div className="flex items-center gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-slate-400 hover:text-slate-700 h-7 w-7 p-0"
                    onClick={() => onEdit(sale)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:text-red-600 hover:bg-red-50 h-7 w-7 p-0"
                    onClick={() => onDelete(sale.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  // Split into batches and solos
  const batches: { batchId: string; sales: ExistingSale[] }[] = [];
  const solos: ExistingSale[] = [];
  const seen = new Set<string>();
  for (const sale of dayDetails) {
    if (!sale.batch_id) {
      solos.push(sale);
    } else if (!seen.has(sale.batch_id)) {
      seen.add(sale.batch_id);
      batches.push({
        batchId: sale.batch_id,
        sales: dayDetails.filter((s) => s.batch_id === sale.batch_id),
      });
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={onBack}
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h2 className="font-semibold text-slate-700">
              {formatDate(selectedDate)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {loadingDay
                ? "Loading..."
                : `${dayDetails.length} transaction${dayDetails.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        {dayDetails.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold text-blue-600">
              {formatCurrency(
                dayDetails.reduce((s, r) => s + r.total_amount, 0),
              )}
            </p>
          </div>
        )}
      </div>

      {loadingDay ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          Loading transactions...
        </div>
      ) : dayDetails.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          No transactions found
        </div>
      ) : (
        <div className="space-y-4">
          {/* Bulk Entries */}
          {batches.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Bulk Entries ({batches.length})
              </h3>
              <div className="space-y-2">
                {batches.map(({ batchId, sales }) => {
                  const batchTotal = sales.reduce(
                    (s, r) => s + r.total_amount,
                    0,
                  );
                  const recorder =
                    (
                      sales[0].recorded_by_profile as {
                        full_name: string;
                      } | null
                    )?.full_name ?? "—";
                  const time =
                    formatDateTime(sales[0].created_at)
                      .split(",")[1]
                      ?.trim() ?? "";
                  const isExpanded = expandedBatches.has(batchId);
                  return (
                    <div
                      key={batchId}
                      className="border rounded-lg overflow-hidden"
                    >
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors text-left"
                        onClick={() => onToggleBatch(batchId)}
                      >
                        <div className="flex items-center gap-3">
                          <Layers className="h-4 w-4 text-blue-500 shrink-0" />
                          <div>
                            <span className="text-sm font-medium text-blue-800">
                              {sales.length} order
                              {sales.length !== 1 ? "s" : ""}
                            </span>
                            <span className="text-xs text-blue-600 ml-3">
                              · {time} · {recorder}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-blue-800">
                            {formatCurrency(batchTotal)}
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-blue-500" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-blue-500" />
                          )}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="border-t">
                          <SaleTable sales={sales} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Direct Entries */}
          {solos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Direct Entries ({solos.length})
              </h3>
              <div className="bg-white rounded-lg border overflow-x-auto">
                <SaleTable sales={solos} />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
