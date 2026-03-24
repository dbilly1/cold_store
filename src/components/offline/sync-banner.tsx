"use client";

import { useEffect, useState } from "react";
import { syncOfflineData } from "@/lib/offline/sync";
import { getUnsynced } from "@/lib/offline/db";
import { useProfile } from "@/hooks/use-profile";
import { WifiOff, RefreshCw, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncBanner() {
  const { profile } = useProfile();
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || !profile) return;
    // Auto-sync when back online
    handleSync();
  }, [isOnline, profile]);

  useEffect(() => {
    checkPending();
  }, []);

  async function checkPending() {
    try {
      const { sales, expenses } = await getUnsynced();
      setPendingCount(sales.length + expenses.length);
    } catch {}
  }

  async function handleSync() {
    if (!profile || syncing) return;
    setSyncing(true);
    try {
      const { synced, errors } = await syncOfflineData(profile.id);
      if (synced > 0) setLastSynced(new Date());
      await checkPending();
    } catch {}
    setSyncing(false);
  }

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className={`px-4 py-2 text-sm flex items-center gap-3 ${!isOnline ? "bg-amber-50 text-amber-800 border-b border-amber-200" : "bg-blue-50 text-blue-800 border-b border-blue-200"}`}>
      {!isOnline ? (
        <>
          <WifiOff className="h-4 w-4 flex-shrink-0" />
          <span>Offline mode — sales are saved locally and will sync when you reconnect</span>
        </>
      ) : pendingCount > 0 ? (
        <>
          <RefreshCw className="h-4 w-4 flex-shrink-0" />
          <span>{pendingCount} item{pendingCount !== 1 ? "s" : ""} pending sync</span>
          <Button size="sm" variant="outline" className="h-6 text-xs ml-auto" onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
