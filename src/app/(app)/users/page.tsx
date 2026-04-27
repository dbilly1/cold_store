import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/require-role";
import { TopBar } from "@/components/layout/top-bar";
import { UsersClient } from "./users-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="User Management" />
      <UsersClient users={users ?? []} />
    </div>
  );
}
