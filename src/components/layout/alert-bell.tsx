"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 60_000; // refresh count every 60 seconds

export function AlertBell() {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    const supabase = createClient();
    const { count: c } = await supabase
      .from("alerts")
      .select("*", { count: "exact", head: true })
      .eq("status", "open");
    setCount(c ?? 0);
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCount]);

  return (
    <Link
      href="/alerts"
      className="relative p-2 hover:bg-slate-100 rounded-lg transition-colors"
      aria-label={count > 0 ? `${count} open alerts` : "Alerts"}
    >
      <Bell className="h-5 w-5 text-slate-600" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
