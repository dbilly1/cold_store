"use client";

import { useState, useRef, useEffect } from "react";
import { useProfile } from "@/hooks/use-profile";
import { Menu, KeyRound, LogOut } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useSidebarContext } from "./sidebar-context";
import { AlertBell } from "./alert-bell";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function TopBar({ title }: { title: string }) {
  const { profile } = useProfile();
  const { open } = useSidebarContext();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

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

        {/* Avatar dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center hover:ring-2 hover:ring-blue-400 hover:ring-offset-1 transition-all"
            aria-label="Account menu"
          >
            <span className="text-xs font-bold text-white">
              {profile?.full_name?.charAt(0).toUpperCase()}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-10 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
              {profile && (
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-sm font-medium text-slate-800 truncate">{profile.full_name}</p>
                  <p className="text-xs text-slate-500 truncate">{profile.email}</p>
                </div>
              )}
              <button
                onClick={() => { setMenuOpen(false); setPwOpen(true); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <KeyRound className="h-4 w-4 text-slate-400" />
                Change Password
              </button>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </header>
  );
}
