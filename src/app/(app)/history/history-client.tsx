"use client";

import { useState } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { SalesHistoryClient } from "../sales-history/sales-history-client";
import { InventoryHistoryClient } from "./inventory-history-client";

type Tab = "sales" | "inventory";

export function HistoryClient() {
  const [activeTab, setActiveTab] = useState<Tab>("sales");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="History" />

      {/* Tab bar */}
      <div className="flex-shrink-0 border-b bg-white px-6">
        <div className="flex gap-1">
          {(
            [
              { key: "sales", label: "Sales History" },
              { key: "inventory", label: "Inventory History" },
            ] as { key: Tab; label: string }[]
          ).map((tab) => (
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
        ) : (
          <InventoryHistoryClient />
        )}
      </div>
    </div>
  );
}
