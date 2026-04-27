import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

export async function requireRole(allowedRoles: UserRole[]) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_approved")
    .eq("id", user.id)
    .single();

  if (!profile || !allowedRoles.includes(profile.role)) redirect("/dashboard");

  return profile;
}
