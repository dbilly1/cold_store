import { createClient } from "@/lib/supabase/server";
import { TopBar } from "@/components/layout/top-bar";
import { CreditClient } from "./credit-client";

export const dynamic = "force-dynamic";

export default async function CreditPage() {
  const supabase = await createClient();

  const { data: customers } = await supabase
    .from("customers")
    .select("id, full_name, phone, notes, created_at")
    .order("full_name");

  const { data: creditSales } = await supabase
    .from("sales")
    .select(`
      id, sale_date, total_amount, customer_id,
      recorded_by_profile:profiles!sales_recorded_by_fkey(full_name),
      items:sale_items(
        id, line_total,
        product:products(name, unit_type)
      )
    `)
    .eq("payment_method", "credit")
    .eq("is_deleted", false)
    .order("sale_date", { ascending: false });

  const { data: creditPayments } = await supabase
    .from("credit_payments")
    .select(`
      id, customer_id, amount, payment_method, payment_date, notes, created_at,
      recorded_by_profile:profiles!credit_payments_recorded_by_fkey(full_name)
    `)
    .order("payment_date", { ascending: false });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar title="Credit Accounts" />
      <CreditClient
        customers={(customers ?? []) as never}
        creditSales={(creditSales ?? []) as never}
        creditPayments={(creditPayments ?? []) as never}
      />
    </div>
  );
}
