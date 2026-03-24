"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useProfile } from "@/hooks/use-profile";
import { createClient } from "@/lib/supabase/client";
import { getRoleLabel, getRoleBadgeColor } from "@/lib/utils";
import {
  LayoutDashboard, ShoppingCart, Package, Sliders, ClipboardList,
  Calculator, Receipt, BarChart3, Bell, ScrollText, Settings,
  LogOut, Snowflake, Users, ChevronRight,
} from "lucide-react";
import type { UserRole } from "@/types/database";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["salesperson", "supervisor", "accountant", "admin"] },
  { label: "Sales", href: "/sales", icon: ShoppingCart, roles: ["salesperson", "supervisor", "admin"] },
  { label: "Inventory", href: "/inventory", icon: Package, roles: ["supervisor", "accountant", "admin"] },
  { label: "Adjustments", href: "/adjustments", icon: Sliders, roles: ["supervisor", "admin"] },
  { label: "Reconciliation", href: "/reconciliation", icon: Calculator, roles: ["salesperson", "supervisor", "admin"] },
  { label: "Stock Audits", href: "/audits", icon: ClipboardList, roles: ["supervisor", "admin"] },
  { label: "Expenses", href: "/expenses", icon: Receipt, roles: ["salesperson", "supervisor", "accountant", "admin"] },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["supervisor", "accountant", "admin"] },
  { label: "Alerts", href: "/alerts", icon: Bell, roles: ["supervisor", "admin"] },
  { label: "Audit Log", href: "/audit-log", icon: ScrollText, roles: ["admin"] },
  { label: "Users", href: "/users", icon: Users, roles: ["admin"] },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["admin"] },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useProfile();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const visibleNav = navItems.filter(
    (item) => profile?.role && item.roles.includes(profile.role)
  );

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
            <Snowflake className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-white leading-tight">Cold Store</p>
            <p className="text-xs text-slate-400">Inventory System</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group",
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {isActive && <ChevronRight className="h-3 w-3" />}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="p-4 border-t border-slate-700">
        {profile && (
          <div className="mb-3">
            <p className="text-sm font-medium text-white truncate">{profile.full_name}</p>
            <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", getRoleBadgeColor(profile.role))}>
              {getRoleLabel(profile.role)}
            </span>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
