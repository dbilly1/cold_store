import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/require-role";
import { TopBar } from "@/components/layout/top-bar";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data: config }, { data: categories }] = await Promise.all([
    supabase.from("system_config").select("*").order("key"),
    supabase.from("categories").select("*").order("name"),
  ]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Settings" />
      <SettingsClient config={config ?? []} categories={categories ?? []} />
    </div>
  );
}
