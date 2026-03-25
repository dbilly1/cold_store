"use client";

import { Sidebar } from "./sidebar";
import { SidebarProvider, useSidebarContext } from "./sidebar-context";

function ShellInner({ children }: { children: React.ReactNode }) {
  const { isOpen, close } = useSidebarContext();

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar — always visible on lg+, slide-in drawer on mobile */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out
          lg:relative lg:translate-x-0 lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <Sidebar />
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {children}
      </main>
    </div>
  );
}

export function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ShellInner>{children}</ShellInner>
    </SidebarProvider>
  );
}
