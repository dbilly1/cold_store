"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import type { DailySummary } from "./page";

interface SalesSummaryTableProps {
  summaries: DailySummary[];
  today: string;
  onRowClick: (date: string) => void;
}

export function SalesSummaryTable({
  summaries,
  today,
  onRowClick,
}: SalesSummaryTableProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-700">All Sales</h2>
        <p className="text-xs text-muted-foreground">
          Last 90 days · click a row to see transactions
        </p>
      </div>
      {summaries.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          No sales recorded yet
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium text-slate-600">
                  Date
                </th>
                <th className="text-center p-3 font-medium text-slate-600">
                  Sales
                </th>
                <th className="text-right p-3 font-medium text-slate-600">
                  Revenue
                </th>
                <th className="text-right p-3 font-medium text-slate-600">
                  Cash
                </th>
                <th className="text-right p-3 font-medium text-slate-600">
                  Mobile
                </th>
                <th className="text-center p-3 font-medium text-slate-600">
                  Reconciliation
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {summaries.map((row) => {
                const isToday = row.date === today;
                const cashVar = row.cash_variance;
                const mobileVar = row.mobile_variance;
                const hasRecon = cashVar !== null;
                const totalVar = (cashVar ?? 0) + (mobileVar ?? 0);

                return (
                  <tr
                    key={row.date}
                    className="hover:bg-slate-50 cursor-pointer border-b"
                    onClick={() => onRowClick(row.date)}
                  >
                    <td className="p-3">
                      <span className="font-medium">{formatDate(row.date)}</span>
                      {isToday && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Today
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-center text-slate-600">
                      {row.count}
                    </td>
                    <td className="p-3 text-right font-semibold">
                      {formatCurrency(row.revenue)}
                    </td>
                    <td className="p-3 text-right text-slate-600">
                      {formatCurrency(row.cash)}
                    </td>
                    <td className="p-3 text-right text-slate-600">
                      {formatCurrency(row.mobile)}
                    </td>
                    <td className="p-3 text-center">
                      {!hasRecon ? (
                        <span className="text-xs text-slate-400">
                          Not reconciled
                        </span>
                      ) : totalVar === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                          <Minus className="h-3 w-3" /> Balanced
                        </span>
                      ) : totalVar > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                          <TrendingUp className="h-3 w-3" /> +
                          {formatCurrency(totalVar)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
                          <TrendingDown className="h-3 w-3" />{" "}
                          {formatCurrency(totalVar)}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-400">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
