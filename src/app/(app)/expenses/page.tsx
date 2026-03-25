import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { ExpensesClient } from "./expenses-client";

export const dynamic = "force-dynamic";
import { format, subDays } from "date-fns";

export default async function ExpensesPage() {
  const supabase = await createClient();
  const monthAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

  const { data: expenses } = await supabase
    .from("expenses")
    .select(`id, expense_date, category, description, amount, paid_from_till, batch_id, created_at,
      recorded_by_profile:profiles!expenses_recorded_by_fkey(full_name)`)
    .gte("expense_date", monthAgo)
    .order("expense_date", { ascending: false });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Expenses" />
      <ExpensesClient expenses={(expenses ?? []) as never} />
    </div>
  );
}
