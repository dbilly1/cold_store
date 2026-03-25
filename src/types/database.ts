export type UserRole = "salesperson" | "supervisor" | "accountant" | "admin";
export type UnitType = "kg" | "units" | "boxes";
export type PaymentMethod = "cash" | "mobile_money" | "credit";
export type AdjustmentReason =
  | "melt_loss"
  | "spoilage"
  | "handling_loss"
  | "measurement_variance"
  | "other";
export type AuditType = "full" | "random";
export type AuditStatus = "draft" | "in_progress" | "completed" | "cancelled";
export type ExpenseCategory =
  | "electricity"
  | "transport"
  | "wages"
  | "rent"
  | "maintenance"
  | "packaging"
  | "cleaning"
  | "miscellaneous";
export type AlertType =
  | "low_stock"
  | "cash_mismatch"
  | "fraud_indicator"
  | "negative_stock"
  | "high_audit_variance"
  | "excessive_adjustments"
  | "unusual_pricing";
export type AlertStatus = "open" | "acknowledged" | "resolved";
export type ReconciliationStatus = "pending" | "balanced" | "flagged";
export type ApprovalStatus = "pending" | "approved" | "rejected";

// ─── Row types (DB columns only, no joins) ───────────────────────────────────

export interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface ProductRow {
  id: string;
  name: string;
  category_id: string | null;
  unit_type: UnitType;
  units_per_box: number | null;
  current_stock_kg: number;
  current_stock_units: number;
  current_stock_boxes: number;
  weighted_avg_cost: number;
  selling_price: number;
  low_stock_threshold: number;
  variance_threshold_pct: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockAdditionRow {
  id: string;
  product_id: string;
  added_by: string;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  cost_price_per_unit: number;
  total_cost: number;
  supplier: string | null;
  notes: string | null;
  created_at: string;
}

export interface SaleRow {
  id: string;
  sale_date: string;
  recorded_by: string;
  notes: string | null;
  total_amount: number;
  discount_amount: number;
  payment_method: PaymentMethod;
  is_deleted: boolean;
  deleted_by: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string;
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  unit_price: number;
  discount_amount: number;
  line_total: number;
  cost_price_at_sale: number;
  created_at: string;
}

export interface StockAdjustmentRow {
  id: string;
  product_id: string;
  adjusted_by: string;
  reason: AdjustmentReason;
  reason_detail: string;
  quantity_kg_delta: number;
  quantity_units_delta: number;
  quantity_boxes_delta: number;
  stock_before_kg: number;
  stock_before_units: number;
  stock_before_boxes: number;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  requires_approval: boolean;
  created_at: string;
}

export interface DailyReconciliationRow {
  id: string;
  reconciliation_date: string;
  submitted_by: string;
  system_cash_total: number;
  system_mobile_total: number;
  actual_cash_entered: number;
  actual_mobile_entered: number;
  cash_variance: number;
  mobile_variance: number;
  status: ReconciliationStatus;
  notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface StockAuditRow {
  id: string;
  audit_type: AuditType;
  audit_date: string;
  conducted_by: string;
  status: AuditStatus;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface StockAuditItemRow {
  id: string;
  audit_id: string;
  product_id: string;
  system_stock_kg: number;
  system_stock_units: number;
  system_stock_boxes: number;
  physical_stock_kg: number;
  physical_stock_units: number;
  physical_stock_boxes: number;
  variance_kg: number;
  variance_units: number;
  variance_boxes: number;
  variance_pct: number;
  within_threshold: boolean;
  notes: string | null;
}

export interface ExpenseRow {
  id: string;
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  recorded_by: string;
  created_at: string;
}

export interface CustomerRow {
  id: string;
  full_name: string;
  phone: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CreditPaymentRow {
  id: string;
  customer_id: string;
  amount: number;
  payment_method: "cash" | "mobile_money";
  payment_date: string;
  recorded_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface AlertRow {
  id: string;
  alert_type: AlertType;
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  status: AlertStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface SystemConfigRow {
  id: string;
  key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

// ─── Convenience aliases (with optional joined data) ─────────────────────────
// Used in application code when joins are fetched

export type Profile = ProfileRow;
export type Category = CategoryRow;
export type Alert = AlertRow;

// ─── Database type (for Supabase client generics) ────────────────────────────
// Supabase JS v2 requires each table to have a Relationships field.

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Omit<ProfileRow, "created_at" | "updated_at">;
        Update: Partial<Omit<ProfileRow, "id" | "created_at">>;
        Relationships: [];
      };
      categories: {
        Row: CategoryRow;
        Insert: Omit<CategoryRow, "id" | "created_at">;
        Update: Partial<Omit<CategoryRow, "id" | "created_at">>;
        Relationships: [];
      };
      products: {
        Row: ProductRow;
        Insert: Omit<ProductRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ProductRow, "id" | "created_at">>;
        Relationships: [];
      };
      stock_additions: {
        Row: StockAdditionRow;
        Insert: Omit<StockAdditionRow, "id" | "created_at">;
        Update: Partial<Omit<StockAdditionRow, "id" | "created_at">>;
        Relationships: [];
      };
      sales: {
        Row: SaleRow;
        Insert: Omit<SaleRow, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<SaleRow, "id" | "created_at">>;
        Relationships: [];
      };
      sale_items: {
        Row: SaleItemRow;
        Insert: Omit<SaleItemRow, "id" | "created_at">;
        Update: Partial<Omit<SaleItemRow, "id" | "created_at">>;
        Relationships: [];
      };
      stock_adjustments: {
        Row: StockAdjustmentRow;
        Insert: Omit<StockAdjustmentRow, "id" | "created_at">;
        Update: Partial<Omit<StockAdjustmentRow, "id" | "created_at">>;
        Relationships: [];
      };
      daily_reconciliations: {
        Row: DailyReconciliationRow;
        Insert: Omit<DailyReconciliationRow, "id" | "created_at" | "cash_variance" | "mobile_variance">;
        Update: Partial<Omit<DailyReconciliationRow, "id" | "created_at" | "cash_variance" | "mobile_variance">>;
        Relationships: [];
      };
      stock_audits: {
        Row: StockAuditRow;
        Insert: Omit<StockAuditRow, "id" | "created_at">;
        Update: Partial<Omit<StockAuditRow, "id" | "created_at">>;
        Relationships: [];
      };
      stock_audit_items: {
        Row: StockAuditItemRow;
        Insert: Omit<StockAuditItemRow, "id" | "variance_kg" | "variance_units" | "variance_boxes">;
        Update: Partial<Omit<StockAuditItemRow, "id">>;
        Relationships: [];
      };
      expenses: {
        Row: ExpenseRow;
        Insert: Omit<ExpenseRow, "id" | "created_at">;
        Update: Partial<Omit<ExpenseRow, "id" | "created_at">>;
        Relationships: [];
      };
      customers: {
        Row: CustomerRow;
        Insert: Omit<CustomerRow, "id" | "created_at">;
        Update: Partial<Omit<CustomerRow, "id" | "created_at">>;
        Relationships: [];
      };
      credit_payments: {
        Row: CreditPaymentRow;
        Insert: Omit<CreditPaymentRow, "id" | "created_at">;
        Update: Partial<Omit<CreditPaymentRow, "id" | "created_at">>;
        Relationships: [];
      };
      alerts: {
        Row: AlertRow;
        Insert: Omit<AlertRow, "id" | "created_at">;
        Update: Partial<Omit<AlertRow, "id" | "created_at">>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: Omit<AuditLogRow, "id" | "created_at">;
        Update: Partial<Omit<AuditLogRow, "id" | "created_at">>;
        Relationships: [];
      };
      system_config: {
        Row: SystemConfigRow;
        Insert: Omit<SystemConfigRow, "id" | "updated_at">;
        Update: Partial<Omit<SystemConfigRow, "id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      unit_type: UnitType;
      payment_method: PaymentMethod;
      adjustment_reason: AdjustmentReason;
      audit_type: AuditType;
      audit_status: AuditStatus;
      expense_category: ExpenseCategory;
      alert_type: AlertType;
      alert_status: AlertStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
