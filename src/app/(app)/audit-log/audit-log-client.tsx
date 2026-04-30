"use client";

import React, { useState } from "react";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────
export interface AuditLogEntry {
  id: string;
  created_at: string;
  action: string;
  entity_type: string | null;
  previous_value: unknown;
  new_value: unknown;
  user_profile: { full_name: string; role: string } | null;
}

interface Props {
  groups: { date: string; entries: AuditLogEntry[] }[];
}

// ── Colour map ────────────────────────────────────────────────
const ACTION_COLORS: Record<string, string> = {
  CREATE_SALE:            "bg-green-100 text-green-800",
  DELETE_SALE:            "bg-red-100 text-red-800",
  EDIT_SALE:              "bg-yellow-100 text-yellow-800",
  CREATE_PRODUCT:         "bg-blue-100 text-blue-800",
  UPDATE_PRODUCT:         "bg-blue-50 text-blue-700",
  ADD_STOCK:              "bg-teal-100 text-teal-800",
  CREATE_ADJUSTMENT:      "bg-amber-100 text-amber-800",
  APPROVE_ADJUSTMENT:     "bg-amber-50 text-amber-700",
  SUBMIT_RECONCILIATION:  "bg-purple-100 text-purple-800",
  COMPLETE_AUDIT:         "bg-indigo-100 text-indigo-800",
  CANCEL_AUDIT:           "bg-slate-100 text-slate-600",
  VOID_AUDIT:             "bg-red-50 text-red-600",
  CREATE_EXPENSE:         "bg-orange-100 text-orange-800",
  ADD_CUSTOMER:           "bg-cyan-100 text-cyan-800",
  RECORD_CREDIT_PAYMENT:  "bg-cyan-50 text-cyan-700",
  UPDATE_SALE:            "bg-yellow-100 text-yellow-800",
  UPDATE_BATCH_DATE:      "bg-yellow-50 text-yellow-700",
};

function dayLabel(dateStr: string) {
  const d = parseISO(dateStr);
  if (isToday(d))     return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, d MMMM yyyy");
}

function formatJson(val: unknown): string {
  try { return JSON.stringify(val, null, 2); } catch { return String(val); }
}

// ── Component ─────────────────────────────────────────────────
export function AuditLogClient({ groups }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    groups.slice(0, 2).forEach((g) => s.add(g.date));
    return s;
  });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  function toggle(date: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (groups.length === 0) {
    return (
      <div className="text-center py-24 text-muted-foreground text-sm">
        No audit log entries yet
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map(({ date, entries }) => {
        const isOpen = expanded.has(date);
        return (
          <div key={date} className="bg-white border rounded-lg overflow-hidden">

            {/* ── Day header (clickable) ── */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
              onClick={() => toggle(date)}
            >
              {isOpen
                ? <ChevronDown  className="h-4 w-4 text-slate-400 flex-shrink-0" />
                : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
              }
              <span className="text-sm font-semibold text-slate-700">
                {dayLabel(date)}
              </span>
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
              </span>
            </button>

            {/* ── Entries table ── */}
            {isOpen && (
              <div className="border-t overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs w-16">Time</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">User</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Action</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Entity</th>
                      <th className="text-left px-4 py-2.5 font-medium text-slate-500 text-xs">Details</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {entries.map((log) => {
                      const rowOpen = expandedRows.has(log.id);
                      const hasPrev = !!log.previous_value;
                      return (
                        <React.Fragment key={log.id}>
                          <tr
                            key={log.id}
                            className="hover:bg-slate-50 cursor-pointer"
                            onClick={() => toggleRow(log.id)}
                          >
                            <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap">
                              {format(parseISO(log.created_at), "HH:mm")}
                            </td>
                            <td className="px-4 py-2.5">
                              <p className="text-xs font-medium leading-tight">
                                {log.user_profile?.full_name ?? "—"}
                              </p>
                              <p className="text-xs text-muted-foreground capitalize leading-tight">
                                {log.user_profile?.role}
                              </p>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs px-2 py-0.5 rounded font-medium ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-700"}`}>
                                {log.action.replace(/_/g, " ")}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600 capitalize">
                              {log.entity_type?.replace(/_/g, " ") ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500 max-w-xs truncate">
                              {log.new_value
                                ? (() => { try { return JSON.stringify(log.new_value); } catch { return "[unserializable]"; } })()
                                : "—"}
                            </td>
                            <td className="px-2 py-2.5">
                              {rowOpen
                                ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                                : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                            </td>
                          </tr>

                          {rowOpen && (
                            <tr className="bg-slate-50">
                              <td colSpan={6} className="px-6 py-4">
                                {hasPrev ? (
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Before</p>
                                      <pre className="text-xs text-slate-600 whitespace-pre-wrap break-all font-mono bg-white border rounded p-3">
                                        {formatJson(log.previous_value)}
                                      </pre>
                                    </div>
                                    <div>
                                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">After</p>
                                      <pre className="text-xs text-slate-600 whitespace-pre-wrap break-all font-mono bg-white border rounded p-3">
                                        {formatJson(log.new_value)}
                                      </pre>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Details</p>
                                    <pre className="text-xs text-slate-600 whitespace-pre-wrap break-all font-mono bg-white border rounded p-3">
                                      {formatJson(log.new_value)}
                                    </pre>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        );
      })}
    </div>
  );
}
