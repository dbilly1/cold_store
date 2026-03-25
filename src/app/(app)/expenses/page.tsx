import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ExpensesClient } from "./expenses-client";
import { format, subDays } from "date-fns";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const supabase = await createClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const monthAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  const isSalesperson = profile?.role === "salesperson";

  const { data: expenses } = await supabase
    .from("expenses")
    .select(`id, expense_date, category, description, amount, paid_from_till, batch_id, created_at,
      recorded_by_profile:profiles!expenses_recorded_by_fkey(full_name)`)
    .gte("expense_date", isSalesperson ? today : monthAgo)
    .lte("expense_date", isSalesperson ? today : today)
    .order("expense_date", { ascending: false });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Expenses" />
      <ExpensesClient expenses={(expenses ?? []) as never} />
    </div>
  );
}
