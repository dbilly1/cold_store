import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { AuditLogClient, type AuditLogEntry } from "./audit-log-client";

export const revalidate = 300;

export default async function AuditLogPage() {
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("audit_logs")
    .select(`*, user_profile:profiles!audit_logs_user_id_fkey(full_name, role)`)
    .order("created_at", { ascending: false })
    .limit(500);

  // ── Group by date ─────────────────────────────────────────────
  const groups: { date: string; entries: AuditLogEntry[] }[] = [];
  const seen = new Map<string, AuditLogEntry[]>();

  for (const log of (logs ?? []) as AuditLogEntry[]) {
    const date = log.created_at.slice(0, 10);
    if (!seen.has(date)) {
      seen.set(date, []);
      groups.push({ date, entries: seen.get(date)! });
    }
    seen.get(date)!.push(log);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Audit Log" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <AuditLogClient groups={groups} />
      </div>
    </div>
  );
}
