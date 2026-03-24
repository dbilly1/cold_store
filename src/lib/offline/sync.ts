import { createClient } from "@/lib/supabase/client";
import { getUnsynced, markSaleSynced, markExpenseSynced } from "./db";

export async function syncOfflineData(userId: string): Promise<{ synced: number; errors: number }> {
  const supabase = createClient();
  const { sales, expenses } = await getUnsynced();
  let synced = 0;
  let errors = 0;

  // Sync sales
  for (const sale of sales) {
    try {
      const { data: newSale, error: saleError } = await supabase
        .from("sales")
        .insert({
          sale_date: sale.sale_date,
          recorded_by: sale.recorded_by,
          notes: sale.notes,
          total_amount: sale.total_amount,
          discount_amount: sale.discount_amount,
          payment_method: sale.payment_method as "cash" | "mobile_money",
          is_deleted: false,
        })
        .select()
        .single();

      if (saleError || !newSale) { errors++; continue; }

      const { error: itemsError } = await supabase.from("sale_items").insert(
        sale.items.map((item) => ({
          sale_id: newSale.id,
          product_id: item.product_id,
          quantity_kg: item.quantity_kg,
          quantity_units: item.quantity_units,
          quantity_boxes: item.quantity_boxes,
          unit_price: item.unit_price,
          discount_amount: item.discount_amount,
          line_total: item.line_total,
          cost_price_at_sale: item.cost_price_at_sale,
        }))
      );

      if (itemsError) {
        await supabase.from("sales").delete().eq("id", newSale.id);
        errors++;
        continue;
      }

      await markSaleSynced(sale.id);
      synced++;
    } catch {
      errors++;
    }
  }

  // Sync expenses
  for (const expense of expenses) {
    try {
      const { error } = await supabase.from("expenses").insert({
        expense_date: expense.expense_date,
        category: expense.category as never,
        description: expense.description,
        amount: expense.amount,
        recorded_by: expense.recorded_by,
      });

      if (error) { errors++; continue; }
      await markExpenseSynced(expense.id);
      synced++;
    } catch {
      errors++;
    }
  }

  return { synced, errors };
}
