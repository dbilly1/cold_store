"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface TablePaginationProps {
  total: number;
  page: number;           // 0-indexed
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  pageSizeOptions?: number[];
  rowLabel?: string;      // default "Rows"
}

function pageButtons(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  if (current <= 3) return [0, 1, 2, 3, 4, "…", total - 1];
  if (current >= total - 4) return [0, "…", total - 5, total - 4, total - 3, total - 2, total - 1];
  return [0, "…", current - 1, current, current + 1, "…", total - 1];
}

export function TablePagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  rowLabel = "Rows",
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t bg-white text-sm gap-4 flex-wrap">
      {/* Count */}
      <p className="text-xs text-slate-500 whitespace-nowrap">
        {total === 0 ? "No entries" : `Showing ${from}–${to} of ${total}`}
      </p>

      {/* Page buttons */}
      <div className="flex items-center gap-1">
        <button
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pageButtons(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-slate-400 text-xs select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                p === page
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {(p as number) + 1}
            </button>
          )
        )}

        <button
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Rows per page */}
      {onPageSizeChange && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 whitespace-nowrap">{rowLabel} per page</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => { onPageSizeChange(parseInt(v)); onPageChange(0); }}
          >
            <SelectTrigger className="h-7 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((s) => (
                <SelectItem key={s} value={s.toString()}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
