"use client";

import { useProfile } from "@/hooks/use-profile";
import { Menu } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useSidebarContext } from "./sidebar-context";
import { AlertBell } from "./alert-bell";

export function TopBar({ title }: { title: string }) {
  const { profile } = useProfile();
  const { open } = useSidebarContext();

  return (
    <header className="h-16 border-b bg-white px-4 sm:px-6 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={open}
          className="lg:hidden p-2 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-500">{formatDate(new Date())}</span>
        {(profile?.role === "admin" || profile?.role === "supervisor") && (
          <AlertBell />
        )}
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-xs font-bold text-white">
              {profile?.full_name?.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
