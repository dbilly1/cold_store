import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MobileShell } from "@/components/layout/mobile-shell";
import { SyncBanner } from "@/components/offline/sync-banner";
import { SessionTimeout } from "@/components/auth/session-timeout";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_approved")
    .eq("id", user.id)
    .single();

  if (!profile?.is_approved) redirect("/pending-approval");

  return (
    <MobileShell>
      <SyncBanner />
      <SessionTimeout />
      {children}
    </MobileShell>
  );
}
