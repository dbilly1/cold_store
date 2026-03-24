import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { AlertsClient } from "./alerts-client";

export default async function AlertsPage() {
  const supabase = await createClient();
  const { data: alerts } = await supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Alerts" />
      <AlertsClient alerts={alerts ?? []} />
    </div>
  );
}
