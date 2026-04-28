"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import type { DailySummary } from "./page";
import type {
  Product,
  ExistingSale,
  Customer,
  EditDialogState,
  DeleteDialogState,
  NewCustomerDialogState,
  EditItem,
} from "./sales-types";
import type { PaymentMethod } from "@/types/database";
import { refreshSales, newBulkRow } from "./sales-types";
import { SingleSaleForm } from "./single-sale-form";
import { BulkEntryDialog } from "./bulk-entry-dialog";
import { EditSaleDialog } from "./edit-sale-dialog";
import { DeleteSaleDialog } from "./delete-sale-dialog";
import { AddCustomerDialog } from "./add-customer-dialog";
import { SalesSummaryTable } from "./sales-summary-table";
import { SalesDrilldown } from "./sales-drilldown";

export function SalesClient({
  products,
  initialSales,
  userRole = "salesperson",
  dailySummaries = [],
  customers: initialCustomers = [],
  page = 0,
  pageSize = 30,
  total = 0,
}: {
  products: Product[];
  initialSales: ExistingSale[];
  userRole?: string;
  dailySummaries?: DailySummary[];
  customers?: Customer[];
  page?: number;
  pageSize?: number;
  total?: number;
}) {
  const { toast } = useToast();
  const { profile } = useProfile();

  // ── Shared state ─────────────────────────────
  const [sales, setSales] = useState<ExistingSale[]>(initialSales);
  const [localDailySummaries, setLocalDailySummaries] =
    useState<DailySummary[]>(dailySummaries);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [creditCustomerId, setCreditCustomerId] = useState("");

  // Drill-down
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetails, setDayDetails] = useState<ExistingSale[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(
    new Set(),
  );

  // Bulk dialog open/close
  const [bulkOpen, setBulkOpen] = useState(false);

  // Edit dialog
  const [editDialog, setEditDialog] = useState<EditDialogState>({
    open: false,
    saleId: "",
    sale_date: "",
    original_sale_date: "",
    paymentMethod: "cash",
    original_payment_method: "cash",
    customer_id: "",
    notes: "",
    items: [],
    originalSale: null,
  });
  const [editSaving, setEditSaving] = useState(false);

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    open: false,
    saleId: "",
    reason: "",
  });

  // New customer dialog
  const [newCustomerDialog, setNewCustomerDialog] =
    useState<NewCustomerDialogState>({
      open: false,
      name: "",
      phone: "",
      source: "single",
    });
  const [customerSaving, setCustomerSaving] = useState(false);

  // Sync summary table when page changes (pagination navigation)
  useEffect(() => {
    setLocalDailySummaries(dailySummaries);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = new Date().toISOString().split("T")[0];
  const isSalesperson = userRole === "salesperson";
  const canBulkEntry = profile?.role !== "salesperson";
  const activeSales = sales.filter((s) => !s.is_deleted);


  // ── openDay ──────────────────────────────────
  async function openDay(date: string) {
    setSelectedDate(date);
    setLoadingDay(true);
    const supabase = createClient();

    const { data } = await supabase
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

    setDayDetails((data ?? []) as unknown as ExistingSale[]);
    setLoadingDay(false);
  }

  // ── openEditDialog ───────────────────────────
  function openEditDialog(sale: ExistingSale) {
    setEditDialog({
      open: true,
      saleId: sale.id,
      sale_date: sale.sale_date,
      original_sale_date: sale.sale_date,
      paymentMethod: sale.payment_method as PaymentMethod,
      original_payment_method: sale.payment_method as PaymentMethod,
      customer_id: sale.customer_id ?? "",
      notes: "",
      originalSale: sale,
      items: (sale.items ?? []).map((item) => {
        const ut =
          (item.product as { name: string; unit_type: string } | null)
            ?.unit_type ?? "units";
        const qty =
          ut === "kg"
            ? item.quantity_kg
            : ut === "boxes"
            ? item.quantity_boxes
            : item.quantity_units;
        return {
          id: item.id,
          product_id: item.product_id,
          productName:
            (item.product as { name: string; unit_type: string } | null)
              ?.name ?? "Unknown",
          unit_type: ut,
          quantity: qty.toString(),
          quantity_boxes: item.quantity_boxes.toString(),
          unit_price: item.unit_price.toString(),
          discount_amount: item.discount_amount.toString(),
        };
      }),
    });
  }

  // ── refreshSummaryRow ────────────────────────
  async function refreshSummaryRow(
    supabase: ReturnType<typeof createClient>,
    date: string,
  ) {
    const { data } = await supabase
      .from("sales")
      .select("total_amount, payment_method")
      .eq("sale_date", date)
      .eq("is_deleted", false);
    if (!data) return;
    const count = data.length;
    const revenue = data.reduce((s, r) => s + r.total_amount, 0);
    const cash = data
      .filter((r) => r.payment_method === "cash")
      .reduce((s, r) => s + r.total_amount, 0);
    const mobile = data
      .filter((r) => r.payment_method === "mobile_money")
      .reduce((s, r) => s + r.total_amount, 0);
    setLocalDailySummaries((prev) => {
      const exists = prev.some((row) => row.date === date);
      const updated = prev.map((row) =>
        row.date === date ? { ...row, count, revenue, cash, mobile } : row,
      );
      if (!exists && count > 0) {
        updated.push({
          date,
          count,
          revenue,
          cash,
          mobile,
          cash_variance: null,
          mobile_variance: null,
        });
        updated.sort((a, b) => b.date.localeCompare(a.date));
      }
      return updated;
    });
  }

  // ── handleDelete ─────────────────────────────
  const handleDelete = async () => {
    if (!deleteDialog.reason.trim()) {
      toast({ title: "Reason is required", variant: "destructive" });
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("sales")
      .update({
        is_deleted: true,
        deleted_by: profile!.id,
        deleted_at: new Date().toISOString(),
        delete_reason: deleteDialog.reason,
      })
      .eq("id", deleteDialog.saleId);

    if (error) {
      toast({
        title: "Failed to delete sale",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const deletedSale =
      dayDetails.find((s) => s.id === deleteDialog.saleId) ??
      sales.find((s) => s.id === deleteDialog.saleId);

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "DELETE_SALE",
      entity_type: "sales",
      entity_id: deleteDialog.saleId,
      new_value: {
        reason: deleteDialog.reason,
        sale_date: deletedSale?.sale_date,
        payment_method: deletedSale?.payment_method,
        total_amount: deletedSale?.total_amount,
        customer_id: deletedSale?.customer_id ?? null,
        items: (deletedSale?.items ?? []).map((i) => ({
          product: (i.product as { name: string } | null)?.name ?? i.product_id,
          quantity_kg: i.quantity_kg,
          quantity_units: i.quantity_units,
          quantity_boxes: i.quantity_boxes,
          unit_price: i.unit_price,
          discount_amount: i.discount_amount,
          line_total: i.line_total,
        })),
      },
    });

    setSales(
      sales.map((s) =>
        s.id === deleteDialog.saleId
          ? { ...s, is_deleted: true, delete_reason: deleteDialog.reason }
          : s,
      ),
    );
    setDeleteDialog({ open: false, saleId: "", reason: "" });
    toast({ title: "Sale deleted", variant: "destructive" });
  };

  // ── handleEditSave ───────────────────────────
  async function handleEditSave() {
    setEditSaving(true);
    try {
      const supabase = createClient();

      const pItems = editDialog.items.map((item) => ({
        id: item.id,
        quantity_kg: item.unit_type === "kg" ? parseFloat(item.quantity) || 0 : 0,
        quantity_units: item.unit_type === "units" ? parseFloat(item.quantity) || 0 : 0,
        quantity_boxes:
          item.unit_type === "boxes"
            ? parseFloat(item.quantity) || 0
            : parseFloat(item.quantity_boxes) || 0,
        unit_price: parseFloat(item.unit_price) || 0,
        discount_amount: parseFloat(item.discount_amount) || 0,
      }));

      const { error: rpcErr } = await supabase.rpc("edit_sale_atomic", {
        p_sale_id: editDialog.saleId,
        p_sale_date: editDialog.sale_date,
        p_payment_method: editDialog.paymentMethod,
        p_customer_id: editDialog.customer_id || null,
        p_items: pItems,
      });

      if (rpcErr) {
        toast({
          title: "Failed to update sale",
          description: rpcErr.message,
          variant: "destructive",
        });
        return;
      }

      const orig = editDialog.originalSale;
      await supabase.from("audit_logs").insert({
        user_id: profile!.id,
        action: "UPDATE_SALE",
        entity_type: "sales",
        entity_id: editDialog.saleId,
        previous_value: orig ? {
          sale_date: orig.sale_date,
          payment_method: orig.payment_method,
          total_amount: orig.total_amount,
          customer_id: orig.customer_id ?? null,
          items: (orig.items ?? []).map((i) => ({
            product: (i.product as { name: string } | null)?.name ?? i.product_id,
            quantity_kg: i.quantity_kg,
            quantity_units: i.quantity_units,
            quantity_boxes: i.quantity_boxes,
            unit_price: i.unit_price,
            discount_amount: i.discount_amount,
            line_total: i.line_total,
          })),
        } : null,
        new_value: {
          sale_date: editDialog.sale_date,
          payment_method: editDialog.paymentMethod,
          customer_id: editDialog.customer_id || null,
          items: editDialog.items.map((i) => ({
            product: i.productName,
            quantity_kg: i.unit_type === "kg" ? parseFloat(i.quantity) || 0 : 0,
            quantity_units: i.unit_type === "units" ? parseFloat(i.quantity) || 0 : 0,
            quantity_boxes: i.unit_type === "boxes"
              ? parseFloat(i.quantity) || 0
              : parseFloat(i.quantity_boxes) || 0,
            unit_price: parseFloat(i.unit_price) || 0,
            discount_amount: parseFloat(i.discount_amount) || 0,
          })),
        },
      });

      const refreshDate = editDialog.sale_date;
      const originalDate = editDialog.original_sale_date;
      const inDrillDown = selectedDate !== null;

      if (inDrillDown) {
        await openDay(refreshDate);
      } else {
        const fresh = await refreshSales(supabase, refreshDate);
        if (fresh) setSales(fresh as unknown as ExistingSale[]);
      }

      if (!isSalesperson) {
        await refreshSummaryRow(supabase, refreshDate);
        if (originalDate && originalDate !== refreshDate) {
          await refreshSummaryRow(supabase, originalDate);
        }
      }

      toast({ title: "Sale updated" });
      setEditDialog((prev) => ({ ...prev, open: false }));
    } finally {
      setEditSaving(false);
    }
  }

  // ── handleBatchDateChange ────────────────────
  async function handleBatchDateChange(batchId: string, newDate: string) {
    const supabase = createClient();
    const oldDate =
      dayDetails.find((s) => s.batch_id === batchId)?.sale_date ??
      selectedDate ??
      "";

    const { error } = await supabase
      .from("sales")
      .update({ sale_date: newDate, updated_at: new Date().toISOString() })
      .eq("batch_id", batchId);

    if (error) {
      toast({ title: "Failed to update batch date", description: error.message, variant: "destructive" });
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "UPDATE_BATCH_DATE",
      entity_type: "sales",
      entity_id: batchId,
      previous_value: { sale_date: oldDate },
      new_value: { sale_date: newDate },
    });

    // Refresh current view — batch moves away from this date
    if (selectedDate) {
      await openDay(selectedDate);
    } else {
      const fresh = await refreshSales(supabase, selectedDate ?? newDate);
      if (fresh) setSales(fresh as unknown as ExistingSale[]);
    }

    if (!isSalesperson) {
      await refreshSummaryRow(supabase, newDate);
      if (selectedDate && selectedDate !== newDate) {
        await refreshSummaryRow(supabase, selectedDate);
      }
    }

    toast({ title: "Batch date updated" });
  }

  // ── handleAddCustomer ────────────────────────
  const handleAddCustomer = async () => {
    if (!newCustomerDialog.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setCustomerSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("customers")
      .insert({
        full_name: newCustomerDialog.name.trim(),
        phone: newCustomerDialog.phone.trim() || null,
        created_by: profile!.id,
      })
      .select("id, full_name, phone")
      .single();
    if (error || !data) {
      toast({
        title: "Failed to add customer",
        description: error?.message,
        variant: "destructive",
      });
      setCustomerSaving(false);
      return;
    }
    const newCust = data as Customer;
    setCustomers((prev) =>
      [...prev, newCust].sort((a, b) =>
        a.full_name.localeCompare(b.full_name),
      ),
    );
    if (newCustomerDialog.source === "single") {
      setCreditCustomerId(newCust.id);
    }
    // Note: bulk row customer update is handled by the BulkEntryDialog internally
    // when the parent passes a newly-created customer via customers prop.
    // For bulk rows, after the customer is added, the BulkEntryDialog
    // receives the updated customers list from the orchestrator.
    setNewCustomerDialog({ open: false, name: "", phone: "", source: "single" });
    toast({ title: "Customer added" });
    setCustomerSaving(false);
  };

  // ── handleSaleRecorded ───────────────────────
  const handleSaleRecorded = async (date: string) => {
    const supabase = createClient();
    // Refresh the live sales list when the saved date is today (salesperson view).
    if (date === today) {
      const fresh = await refreshSales(supabase, today);
      if (fresh) setSales(fresh as unknown as ExistingSale[]);
    }
    // Always keep the summary table in sync for the saved date.
    if (!isSalesperson) {
      await refreshSummaryRow(supabase, date);
    }
  };

  // ── handleBulkSaved ──────────────────────────
  const handleBulkSaved = async () => {
    const supabase = createClient();
    const fresh = await refreshSales(supabase, today);
    if (fresh) setSales(fresh as unknown as ExistingSale[]);
  };

  // ─────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row gap-0">
      {/* ── Left: Single Sale Form ── */}
      <SingleSaleForm
        products={products}
        customers={customers}
        profile={profile}
        today={today}
        canBulkEntry={canBulkEntry}
        creditCustomerId={creditCustomerId}
        onCreditCustomerChange={setCreditCustomerId}
        onNewCustomer={() =>
          setNewCustomerDialog({
            open: true,
            name: "",
            phone: "",
            source: "single",
          })
        }
        onSaleRecorded={handleSaleRecorded}
        onBulkOpen={() => setBulkOpen(true)}
      />

      {/* ── Right panel ── */}
      <div className="flex-1 lg:overflow-y-auto p-4 md:p-6">
        {/* ─ Salesperson: today's sales table ─ */}
        {isSalesperson && (
          <SalesDrilldown
            selectedDate={today}
            dayDetails={activeSales}
            loadingDay={false}
            expandedBatches={expandedBatches}
            profile={profile}
            hideBack
            onBack={() => {}}
            onToggleBatch={(batchId) =>
              setExpandedBatches((prev) => {
                const next = new Set(prev);
                next.has(batchId) ? next.delete(batchId) : next.add(batchId);
                return next;
              })
            }
            onEdit={openEditDialog}
            onDelete={(saleId) =>
              setDeleteDialog({ open: true, saleId, reason: "" })
            }
            onBatchDateChange={handleBatchDateChange}
          />
        )}

        {/* ─ Non-salesperson: daily summary table ─ */}
        {!isSalesperson && !selectedDate && (
          <SalesSummaryTable
            summaries={localDailySummaries}
            today={today}
            onRowClick={openDay}
            page={page}
            pageSize={pageSize}
            total={total}
          />
        )}

        {/* ─ Day drill-down view ─ */}
        {!isSalesperson && selectedDate && (
          <SalesDrilldown
            selectedDate={selectedDate}
            dayDetails={dayDetails}
            loadingDay={loadingDay}
            expandedBatches={expandedBatches}
            profile={profile}
            onBack={() => {
              setSelectedDate(null);
              setDayDetails([]);
              setExpandedBatches(new Set());
            }}
            onToggleBatch={(batchId) =>
              setExpandedBatches((prev) => {
                const next = new Set(prev);
                next.has(batchId) ? next.delete(batchId) : next.add(batchId);
                return next;
              })
            }
            onEdit={openEditDialog}
            onDelete={(saleId) =>
              setDeleteDialog({ open: true, saleId, reason: "" })
            }
            onBatchDateChange={handleBatchDateChange}
          />
        )}
      </div>

      {/* ── Bulk Entry Dialog ── */}
      <BulkEntryDialog
        open={bulkOpen}
        products={products}
        customers={customers}
        profile={profile}
        today={today}
        onClose={() => setBulkOpen(false)}
        onSaved={handleBulkSaved}
        onNewCustomer={(rowId) =>
          setNewCustomerDialog({ open: true, name: "", phone: "", source: rowId })
        }
      />

      {/* ── Edit Sale Dialog ── */}
      <EditSaleDialog
        dialog={editDialog}
        customers={customers}
        products={products}
        profile={profile}
        isSalesperson={isSalesperson}
        selectedDate={selectedDate}
        onClose={() => setEditDialog((prev) => ({ ...prev, open: false }))}
        onChange={(patch) => setEditDialog((prev) => ({ ...prev, ...patch }))}
        onItemChange={(idx, patch) =>
          setEditDialog((prev) => ({
            ...prev,
            items: prev.items.map((it, i) =>
              i === idx ? { ...it, ...patch } : it,
            ),
          }))
        }
        onSave={handleEditSave}
        saving={editSaving}
        onNewCustomer={() =>
          setNewCustomerDialog({
            open: true,
            name: "",
            phone: "",
            source: "single",
          })
        }
      />

      {/* ── Delete Sale Dialog ── */}
      <DeleteSaleDialog
        open={deleteDialog.open}
        reason={deleteDialog.reason}
        onReasonChange={(reason) =>
          setDeleteDialog((prev) => ({ ...prev, reason }))
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteDialog({ open: false, saleId: "", reason: "" })}
      />

      {/* ── Add Customer Dialog ── */}
      <AddCustomerDialog
        open={newCustomerDialog.open}
        name={newCustomerDialog.name}
        phone={newCustomerDialog.phone}
        saving={customerSaving}
        onChange={(patch) =>
          setNewCustomerDialog((prev) => ({ ...prev, ...patch }))
        }
        onSave={handleAddCustomer}
        onClose={() =>
          setNewCustomerDialog((prev) => ({ ...prev, open: false }))
        }
      />
    </div>
  );
}
