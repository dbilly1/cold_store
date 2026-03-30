"use client";

import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { SalesHistoryClient } from "../sales-history/sales-history-client";
import { InventoryHistoryClient } from "./inventory-history-client";
import { AuditLogClient } from "../audit-log/audit-log-client";
import { useProfile } from "@/hooks/use-profile";
import { createClient } from "@/lib/supabase/client";
import { useEffect } from "react";
import type { AuditLogEntry } from "../audit-log/audit-log-client";

type Tab = "sales" | "inventory" | "audit-log";

export function HistoryClient() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

  const [activeTab, setActiveTab] = useState<Tab>("sales");
  const [auditGroups, setAuditGroups] = useState<{ date: string; entries: AuditLogEntry[] }[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Fetch audit log when tab is activated
  useEffect(() => {
    if (activeTab !== "audit-log" || auditGroups.length > 0) return;
    setAuditLoading(true);
    const supabase = createClient();
    supabase
      .from("audit_logs")
      .select(`*, user_profile:profiles!audit_logs_user_id_fkey(full_name, role)`)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        const groups: { date: string; entries: AuditLogEntry[] }[] = [];
        const seen = new Map<string, AuditLogEntry[]>();
        for (const log of (data ?? []) as AuditLogEntry[]) {
          const date = log.created_at.slice(0, 10);
          if (!seen.has(date)) {
            seen.set(date, []);
            groups.push({ date, entries: seen.get(date)! });
          }
          seen.get(date)!.push(log);
        }
        setAuditGroups(groups);
        setAuditLoading(false);
      });
  }, [activeTab, auditGroups.length]);

  const tabs = [
    { key: "sales" as Tab,       label: "Sales History",     show: true },
    { key: "inventory" as Tab,   label: "Inventory History", show: true },
    { key: "audit-log" as Tab,   label: "Audit Log",         show: isAdmin },
  ].filter((t) => t.show);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="History" />

      {/* Tab bar */}
      <div className="flex-shrink-0 border-b bg-white px-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "sales" ? (
          <SalesHistoryClient embedded={true} />
        ) : activeTab === "inventory" ? (
          <InventoryHistoryClient />
        ) : (
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            {auditLoading ? (
              <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
                Loading audit log…
              </div>
            ) : (
              <AuditLogClient groups={auditGroups} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
