"use client";

import { useProfile } from "@/hooks/use-profile";
import { Bell } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export function TopBar({ title }: { title: string }) {
  const { profile } = useProfile();

  return (
    <header className="h-16 border-b bg-white px-6 flex items-center justify-between flex-shrink-0">
      <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-500">{formatDate(new Date())}</span>
        {(profile?.role === "admin" || profile?.role === "supervisor") && (
          <Link href="/alerts" className="relative p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <Bell className="h-5 w-5 text-slate-600" />
          </Link>
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
