import type { PaymentMethod, ExpenseCategory } from "@/types/database";
import { createClient } from "@/lib/supabase/client";

// ─────────────────────────────────────────────
// Domain interfaces
// ─────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  unit_type: string;
  units_per_box: number | null;
  current_stock_kg: number;
  current_stock_units: number;
  current_stock_boxes: number;
  selling_price: number;
  weighted_avg_cost: number;
}

export interface SaleItem {
  product_id: string;
  product_name: string;
  unit_type: string;
  quantity: number;
  quantity_boxes: number;
  units_per_box: number; // 0 means product doesn't sell in boxes
  unit_price: number;
  discount: number;
}

export interface ExistingSale {
  id: string;
  sale_date: string;
  total_amount: number;
  discount_amount: number;
  payment_method: string;
  is_deleted: boolean;
  delete_reason: string | null;
  created_at: string;
  batch_id: string | null;
  customer_id: string | null;
  recorded_by_profile: { full_name: string } | null;
  items: Array<{
    id: string;
    product_id: string;
    quantity_kg: number;
    quantity_units: number;
    quantity_boxes: number;
    unit_price: number;
    discount_amount: number;
    line_total: number;
    product: { name: string; unit_type: string } | null;
  }>;
}

export interface Customer {
  id: string;
  full_name: string;
  phone: string | null;
}

// ─────────────────────────────────────────────
// Bulk order row — each row = one separate sale
// ─────────────────────────────────────────────
export interface BulkRow {
  id: string; // local key
  product_id: string;
  unit_type: string;
  quantity: string;
  quantity_boxes: string;
  unit_price: string;
  discount: string;
  payment_method: PaymentMethod;
  customer_id: string;
}

export interface BulkExpenseRow {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
}

export interface EditItem {
  id: string;
  product_id: string;
  productName: string;
  unit_type: string;
  quantity: string;
  quantity_boxes: string;
  unit_price: string;
  discount_amount: string;
}

export interface EditDialogState {
  open: boolean;
  saleId: string;
  sale_date: string;
  original_sale_date: string;
  paymentMethod: PaymentMethod;
  original_payment_method: PaymentMethod;
  customer_id: string;
  notes: string;
  items: EditItem[];
  originalSale: ExistingSale | null;
}

export interface DeleteDialogState {
  open: boolean;
  saleId: string;
  reason: string;
}

export interface NewCustomerDialogState {
  open: boolean;
  name: string;
  phone: string;
  source: "single" | string; // "single" or a bulk row id
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "electricity", label: "Electricity" },
  { value: "transport", label: "Transport" },
  { value: "wages", label: "Wages" },
  { value: "rent", label: "Rent" },
  { value: "maintenance", label: "Maintenance" },
  { value: "packaging", label: "Packaging" },
  { value: "cleaning", label: "Cleaning" },
  { value: "miscellaneous", label: "Miscellaneous" },
];

// ─────────────────────────────────────────────
// Helper functions
// ─────────────────────────────────────────────

export const newBulkRow = (): BulkRow => ({
  id: crypto.randomUUID(),
  product_id: "",
  unit_type: "",
  quantity: "",
  quantity_boxes: "0",
  unit_price: "",
  discount: "0",
  payment_method: "cash",
  customer_id: "",
});

export function lineTotal(item: SaleItem) {
  const boxEquiv = item.quantity_boxes * (item.units_per_box || 0);
  return Math.max(0, (item.quantity + boxEquiv) * item.unit_price - item.discount);
}

export function bulkLineTotal(row: BulkRow, products: Product[]) {
  const product = products.find((p) => p.id === row.product_id);
  const qty = parseFloat(row.quantity) || 0;
  const boxes = parseFloat(row.quantity_boxes) || 0;
  const price = parseFloat(row.unit_price) || 0;
  const disc = parseFloat(row.discount) || 0;
  // For "boxes" products the primary unit IS a box — price is per box
  if (product?.unit_type === "boxes") {
    return Math.max(0, boxes * price - disc);
  }
  const boxEquiv = boxes * (product?.units_per_box || 0);
  return Math.max(0, (qty + boxEquiv) * price - disc);
}

export async function refreshSales(
  supabase: ReturnType<typeof createClient>,
  date: string,
) {
  const { data, error } = await supabase
    .from("sales")
    .select(
      `
      id, sale_date, total_amount, discount_amount, payment_method,
      is_deleted, delete_reason, created_at, batch_id, customer_id,
      recorded_by_profile:profiles!sales_recorded_by_fkey(full_name),
      items:sale_items(
        id, product_id, quantity_kg, quantity_units, quantity_boxes,
        unit_price, discount_amount, line_total,
        product:products(name, unit_type)
      )
    `,
    )
    .eq("sale_date", date)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("refreshSales error:", error.message);
    return null;
  }
  return data;
}
