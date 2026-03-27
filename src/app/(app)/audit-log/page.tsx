import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

export const revalidate = 300; // refresh every 5 minutes

export default async function AuditLogPage() {
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("audit_logs")
    .select(`*, user_profile:profiles!audit_logs_user_id_fkey(full_name, role)`)
    .order("created_at", { ascending: false })
    .limit(200);

  const ACTION_COLORS: Record<string, string> = {
    CREATE_SALE: "bg-green-100 text-green-800",
    DELETE_SALE: "bg-red-100 text-red-800",
    CREATE_PRODUCT: "bg-blue-100 text-blue-800",
    UPDATE_PRODUCT: "bg-blue-50 text-blue-700",
    ADD_STOCK: "bg-teal-100 text-teal-800",
    CREATE_ADJUSTMENT: "bg-amber-100 text-amber-800",
    SUBMIT_RECONCILIATION: "bg-purple-100 text-purple-800",
    COMPLETE_AUDIT: "bg-indigo-100 text-indigo-800",
    CREATE_EXPENSE: "bg-orange-100 text-orange-800",
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Audit Log" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium text-slate-600">Timestamp</th>
                <th className="text-left p-3 font-medium text-slate-600">User</th>
                <th className="text-left p-3 font-medium text-slate-600">Action</th>
                <th className="text-left p-3 font-medium text-slate-600">Entity</th>
                <th className="text-left p-3 font-medium text-slate-600">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs?.map((log) => {
                const profile = log.user_profile as { full_name: string; role: string } | null;
                return (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td className="p-3">
                      <p className="font-medium text-xs">{profile?.full_name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{profile?.role}</p>
                    </td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-700"}`}>
                        {log.action.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-slate-600 capitalize">{log.entity_type?.replace(/_/g, " ")}</td>
                    <td className="p-3 text-xs text-slate-500 max-w-xs truncate">
                      {log.new_value ? JSON.stringify(log.new_value) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(!logs || logs.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">No audit log entries</div>
          )}
        </div>
      </div>
    </div>
  );
}
