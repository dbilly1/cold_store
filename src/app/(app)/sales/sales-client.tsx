"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatCurrency, formatDateTime, formatDate } from "@/lib/utils";
import {
  Plus,
  Trash2,
  ShoppingCart,
  X,
  Layers,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import type { PaymentMethod } from "@/types/database";
import type { DailySummary } from "./page";

interface Product {
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

interface SaleItem {
  product_id: string;
  product_name: string;
  unit_type: string;
  quantity: number;
  quantity_boxes: number;
  unit_price: number;
  discount: number;
}

interface ExistingSale {
  id: string;
  sale_date: string;
  total_amount: number;
  discount_amount: number;
  payment_method: string;
  is_deleted: boolean;
  delete_reason: string | null;
  created_at: string;
  batch_id: string | null;
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

// ─────────────────────────────────────────────
// Bulk order row — each row = one separate sale
// ─────────────────────────────────────────────
interface BulkRow {
  id: string; // local key
  product_id: string;
  unit_type: string;
  quantity: string;
  quantity_boxes: string;
  unit_price: string;
  discount: string;
  payment_method: PaymentMethod;
}

const newBulkRow = (): BulkRow => ({
  id: crypto.randomUUID(),
  product_id: "",
  unit_type: "",
  quantity: "",
  quantity_boxes: "0",
  unit_price: "",
  discount: "0",
  payment_method: "cash",
});

function bulkLineTotal(row: BulkRow, products: Product[]) {
  const product = products.find((p) => p.id === row.product_id);
  const qty = product?.unit_type === "boxes"
    ? parseFloat(row.quantity_boxes) || 0
    : parseFloat(row.quantity) || 0;
  const price = parseFloat(row.unit_price) || 0;
  const disc = parseFloat(row.discount) || 0;
  return Math.max(0, qty * price - disc);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function lineTotal(item: SaleItem) {
  return Math.max(0, item.quantity * item.unit_price - item.discount);
}

async function refreshSales(
  supabase: ReturnType<typeof createClient>,
  date: string,
) {
  const { data } = await supabase
    .from("sales")
    .select(
      `
      id, sale_date, total_amount, discount_amount, payment_method,
      is_deleted, delete_reason, created_at,
      recorded_by_profile:profiles!sales_recorded_by_fkey(full_name),
      items:sale_items(
        id, product_id, quantity_kg, quantity_units, quantity_boxes,
        unit_price, discount_amount, line_total,
        product:products(name, unit_type)
      )
    `,
    )
    .eq("sale_date", date)
    .order("created_at", { ascending: false });
  return data;
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export function SalesClient({
  products,
  initialSales,
  userRole = "salesperson",
  dailySummaries = [],
}: {
  products: Product[];
  initialSales: ExistingSale[];
  userRole?: string;
  dailySummaries?: DailySummary[];
}) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [sales, setSales] = useState<ExistingSale[]>(initialSales);

  // Single sale state
  const [items, setItems] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [saleDiscount, setSaleDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");

  // Bulk sale state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([newBulkRow()]);
  const [bulkDate, setBulkDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResults, setBulkResults] = useState<
    { id: string; ok: boolean; msg?: string }[]
  >([]);
  // Bulk reconciliation
  const [bulkReconEnabled, setBulkReconEnabled] = useState(false);
  const [bulkActualCash, setBulkActualCash] = useState("");
  const [bulkActualMobile, setBulkActualMobile] = useState("");

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    saleId: string;
    reason: string;
  }>({
    open: false,
    saleId: "",
    reason: "",
  });

  const today = new Date().toISOString().split("T")[0];

  // ── Single sale ──────────────────────────────
  const addItem = () => {
    const product = products.find((p) => p.id === selectedProductId);
    if (!product) return;
    if (items.find((i) => i.product_id === product.id)) {
      toast({ title: "Product already added", variant: "destructive" });
      return;
    }
    setItems([
      ...items,
      {
        product_id: product.id,
        product_name: product.name,
        unit_type: product.unit_type,
        quantity: 1,
        quantity_boxes: 0,
        unit_price: product.selling_price,
        discount: 0,
      },
    ]);
    setSelectedProductId("");
  };

  const removeItem = (idx: number) =>
    setItems(items.filter((_, i) => i !== idx));
  const updateItem = (
    idx: number,
    field: keyof SaleItem,
    value: number | string,
  ) =>
    setItems(
      items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    );

  const subtotal = items.reduce((s, item) => s + lineTotal(item), 0);
  const grandTotal = Math.max(0, subtotal - saleDiscount);

  const handleSubmit = async () => {
    if (items.length === 0) {
      toast({ title: "Add at least one item", variant: "destructive" });
      return;
    }
    setSaving(true);
    const supabase = createClient();

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        sale_date: today,
        recorded_by: profile!.id,
        total_amount: grandTotal,
        discount_amount: saleDiscount,
        payment_method: paymentMethod,
        notes: notes || null,
        is_deleted: false,
      })
      .select()
      .single();

    if (saleError || !sale) {
      toast({
        title: "Failed to save sale",
        description: saleError?.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    const saleItems = items.map((item) => ({
      sale_id: sale.id,
      product_id: item.product_id,
      quantity_kg: item.unit_type === "kg" ? item.quantity : 0,
      quantity_units: item.unit_type === "units" ? item.quantity : 0,
      quantity_boxes: item.quantity_boxes,
      unit_price: item.unit_price,
      discount_amount: item.discount,
      line_total: lineTotal(item),
      cost_price_at_sale:
        products.find((p) => p.id === item.product_id)?.weighted_avg_cost ?? 0,
    }));

    const { error: itemsError } = await supabase
      .from("sale_items")
      .insert(saleItems);
    if (itemsError) {
      await supabase.from("sales").delete().eq("id", sale.id);
      toast({
        title: "Failed to save items",
        description: itemsError.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "CREATE_SALE",
      entity_type: "sales",
      entity_id: sale.id,
      new_value: { total_amount: grandTotal, items: items.length },
    });

    toast({ title: "Sale recorded" });
    setItems([]);
    setSaleDiscount(0);
    setNotes("");
    const fresh = await refreshSales(supabase, today);
    if (fresh) setSales(fresh as unknown as ExistingSale[]);
    setSaving(false);
  };

  // ── Bulk sale ────────────────────────────────
  const updateBulkRow = (id: string, patch: Partial<BulkRow>) =>
    setBulkRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const removeBulkRow = (id: string) =>
    setBulkRows((rows) => rows.filter((r) => r.id !== id));

  // When product is selected in a bulk row, auto-fill price
  const onBulkProductChange = (rowId: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    const isBoxes = product?.unit_type === "boxes";
    updateBulkRow(rowId, {
      product_id: productId,
      unit_type: product?.unit_type ?? "",
      unit_price: product?.selling_price?.toString() ?? "",
      quantity: isBoxes ? "" : "1",
      quantity_boxes: isBoxes ? "1" : "0",
    });
  };

  const bulkGrandTotal = bulkRows.reduce((s, r) => s + bulkLineTotal(r, products), 0);
  const bulkValidRows = bulkRows.filter(
    (r) =>
      r.product_id &&
      (parseFloat(r.quantity) > 0 || parseFloat(r.quantity_boxes) > 0),
  );

  const handleBulkSave = async () => {
    if (bulkValidRows.length === 0) {
      toast({
        title: "No valid orders to save",
        description: "Each row needs a product and quantity.",
        variant: "destructive",
      });
      return;
    }
    setBulkSaving(true);
    setBulkResults([]);
    const supabase = createClient();
    const results: { id: string; ok: boolean; msg?: string }[] = [];
    const saleDate = bulkDate || today;
    const batchId = crypto.randomUUID();

    for (const row of bulkValidRows) {
      const product = products.find((p) => p.id === row.product_id)!;
      const qty = parseFloat(row.quantity) || 0;
      const qBoxes = parseFloat(row.quantity_boxes) || 0;
      const price = parseFloat(row.unit_price) || 0;
      const disc = parseFloat(row.discount) || 0;
      const effectiveQty = product.unit_type === "boxes" ? qBoxes : qty;
      const total = Math.max(0, effectiveQty * price - disc);

      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .insert({
          sale_date: saleDate,
          recorded_by: profile!.id,
          total_amount: total,
          discount_amount: disc,
          payment_method: row.payment_method,
          notes: bulkNotes || null,
          is_deleted: false,
          batch_id: batchId,
        })
        .select()
        .single();

      if (saleErr || !sale) {
        results.push({
          id: row.id,
          ok: false,
          msg: saleErr?.message ?? "Unknown error",
        });
        continue;
      }

      const { error: itemErr } = await supabase.from("sale_items").insert({
        sale_id: sale.id,
        product_id: product.id,
        quantity_kg: product.unit_type === "kg" ? qty : 0,
        quantity_units: product.unit_type === "units" ? qty : 0,
        quantity_boxes: qBoxes,
        unit_price: price,
        discount_amount: disc,
        line_total: total,
        cost_price_at_sale: product.weighted_avg_cost,
      });

      if (itemErr) {
        await supabase.from("sales").delete().eq("id", sale.id);
        results.push({ id: row.id, ok: false, msg: itemErr.message });
      } else {
        results.push({ id: row.id, ok: true });
        await supabase.from("audit_logs").insert({
          user_id: profile!.id,
          action: "CREATE_SALE",
          entity_type: "sales",
          entity_id: sale.id,
          new_value: { total_amount: total, bulk: true },
        });
      }
    }

    const saved = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    // Optional reconciliation
    if (bulkReconEnabled && saved > 0) {
      const sysCash = bulkValidRows
        .filter((r) => r.payment_method === "cash")
        .reduce((s, r) => s + bulkLineTotal(r, products), 0);
      const sysMobile = bulkValidRows
        .filter((r) => r.payment_method === "mobile_money")
        .reduce((s, r) => s + bulkLineTotal(r, products), 0);
      const actCash = parseFloat(bulkActualCash) || 0;
      const actMobile = parseFloat(bulkActualMobile) || 0;
      const status =
        actCash === sysCash && actMobile === sysMobile ? "balanced" : "flagged";

      const { data: reconData, error: reconErr } = await supabase
        .from("daily_reconciliations")
        .upsert(
          {
            reconciliation_date: saleDate,
            submitted_by: profile!.id,
            system_cash_total: sysCash,
            system_mobile_total: sysMobile,
            actual_cash_entered: actCash,
            actual_mobile_entered: actMobile,
            status,
            notes: bulkNotes || null,
          },
          { onConflict: "reconciliation_date" },
        )
        .select()
        .single();

      if (!reconErr && reconData && status === "flagged") {
        await supabase.from("alerts").insert({
          alert_type: "cash_mismatch",
          severity: "high",
          title: "Cash Reconciliation Mismatch",
          message: `Cash variance: ${formatCurrency(actCash - sysCash)}, Mobile variance: ${formatCurrency(actMobile - sysMobile)}`,
          related_entity_type: "daily_reconciliations",
          related_entity_id: reconData.id,
        });
      }
    }

    setBulkResults(results);

    if (saved > 0) {
      const fresh = await refreshSales(supabase, today);
      if (fresh) setSales(fresh as unknown as ExistingSale[]);
    }

    if (failed === 0) {
      toast({
        title: `${saved} order${saved > 1 ? "s" : ""} saved${bulkReconEnabled ? " & reconciled" : ""}`,
      });
      setBulkOpen(false);
      setBulkRows([newBulkRow()]);
      setBulkDate(today);
      setBulkNotes("");
      setBulkResults([]);
      setBulkReconEnabled(false);
      setBulkActualCash("");
      setBulkActualMobile("");
    } else {
      toast({
        title: `${saved} saved, ${failed} failed`,
        description: "Failed rows are highlighted — fix and retry.",
        variant: "destructive",
      });
    }

    setBulkSaving(false);
  };

  // ── Delete sale ──────────────────────────────
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

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "DELETE_SALE",
      entity_type: "sales",
      entity_id: deleteDialog.saleId,
      new_value: { reason: deleteDialog.reason },
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

  // Daily drill-down (non-salesperson)
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetails, setDayDetails] = useState<ExistingSale[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);

  const activeSales = sales.filter((s) => !s.is_deleted);
  const dailyTotal = activeSales.reduce((s, sale) => s + sale.total_amount, 0);
  const canBulkEntry = profile?.role !== "salesperson";
  const isSalesperson = userRole === "salesperson";

  async function openDay(date: string) {
    setSelectedDate(date);
    setLoadingDay(true);
    const supabase = createClient();

    const baseSelect = `
      id, sale_date, total_amount, discount_amount, payment_method,
      is_deleted, delete_reason, created_at,
      recorded_by_profile:profiles!sales_recorded_by_fkey(full_name),
      items:sale_items(
        id, product_id, quantity_kg, quantity_units, quantity_boxes,
        unit_price, discount_amount, line_total,
        product:products(name, unit_type)
      )
    `;

    let { data, error } = await supabase
      .from("sales")
      .select(`${baseSelect}, batch_id`)
      .eq("sale_date", date)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });

    // batch_id column may not exist yet — fall back to query without it
    if (error) {
      ({ data } = await supabase
        .from("sales")
        .select(baseSelect)
        .eq("sale_date", date)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false }));
    }

    setDayDetails((data ?? []) as unknown as ExistingSale[]);
    setLoadingDay(false);
  }

  // ─────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-0">
      {/* ── Left: Single Sale Form ── */}
      <div className="lg:w-[420px] border-r bg-white flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-500" />
            New Sale
          </h2>
          {canBulkEntry && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
              onClick={() => {
                setBulkRows([newBulkRow()]);
                setBulkResults([]);
                setBulkNotes("");
                setBulkDate(today);
                setBulkOpen(true);
              }}
            >
              <Layers className="h-3.5 w-3.5" />
              Bulk Entry
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Product selector */}
          <div className="flex gap-2">
            <Select
              value={selectedProductId}
              onValueChange={setSelectedProductId}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select product..." />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {formatCurrency(p.selling_price)}/{p.unit_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={addItem} size="icon" disabled={!selectedProductId}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No items added yet
            </p>
          )}

          {items.map((item, idx) => (
            <Card key={item.product_id} className="p-3">
              <div className="flex items-start justify-between mb-2">
                <p className="font-medium text-sm">{item.product_name}</p>
                <button
                  onClick={() => removeItem(idx)}
                  className="text-slate-400 hover:text-red-500"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <Label className="text-xs">Qty ({item.unit_type})</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(
                        idx,
                        "quantity",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit Price</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(e) =>
                      updateItem(
                        idx,
                        "unit_price",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Boxes</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={item.quantity_boxes}
                    onChange={(e) =>
                      updateItem(
                        idx,
                        "quantity_boxes",
                        parseInt(e.target.value) || 0,
                      )
                    }
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Discount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount}
                    onChange={(e) =>
                      updateItem(
                        idx,
                        "discount",
                        parseFloat(e.target.value) || 0,
                      )
                    }
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <p className="text-right text-sm font-semibold mt-2">
                {formatCurrency(lineTotal(item))}
              </p>
            </Card>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t space-y-3 bg-slate-50">
          <div className="flex justify-between text-sm">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Label className="w-24 flex-shrink-0">Sale Discount</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={saleDiscount}
              onChange={(e) => setSaleDiscount(parseFloat(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span className="text-blue-600 text-lg">
              {formatCurrency(grandTotal)}
            </span>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Payment Method</Label>
            <div className="flex gap-2">
              {(["cash", "mobile_money"] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    paymentMethod === m
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m === "cash" ? "Cash" : "Mobile Money"}
                </button>
              ))}
            </div>
          </div>
          <Input
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="text-sm"
          />
          <Button
            onClick={handleSubmit}
            className="w-full"
            disabled={saving || items.length === 0}
          >
            {saving
              ? "Saving..."
              : `Record Sale — ${formatCurrency(grandTotal)}`}
          </Button>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ─ Salesperson: today's sales cards ─ */}
        {isSalesperson && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-700">
                Today&apos;s Sales
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({activeSales.length} transaction
                  {activeSales.length !== 1 ? "s" : ""})
                </span>
              </h2>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(dailyTotal)}
                </p>
              </div>
            </div>
            {activeSales.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                No sales recorded today
              </div>
            ) : (
              <div className="space-y-3">
                {activeSales.map((sale) => (
                  <Card key={sale.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold">
                              {formatCurrency(sale.total_amount)}
                            </span>
                            <Badge
                              variant={
                                sale.payment_method === "cash"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {sale.payment_method === "cash"
                                ? "Cash"
                                : "Mobile Money"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(sale.created_at)} ·{" "}
                            {
                              (
                                sale.recorded_by_profile as {
                                  full_name: string;
                                } | null
                              )?.full_name
                            }
                          </p>
                          <div className="mt-2 space-y-0.5">
                            {sale.items?.map((item) => (
                              <p
                                key={item.id}
                                className="text-xs text-slate-600"
                              >
                                {
                                  (
                                    item.product as {
                                      name: string;
                                      unit_type: string;
                                    } | null
                                  )?.name
                                }{" "}
                                ·{" "}
                                {item.quantity_kg > 0
                                  ? `${item.quantity_kg} kg`
                                  : `${item.quantity_units} units`}
                                {item.quantity_boxes > 0
                                  ? ` + ${item.quantity_boxes} boxes`
                                  : ""}{" "}
                                · {formatCurrency(item.line_total)}
                              </p>
                            ))}
                          </div>
                        </div>
                        {(profile?.role === "salesperson" ||
                          profile?.role === "supervisor" ||
                          profile?.role === "admin") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() =>
                              setDeleteDialog({
                                open: true,
                                saleId: sale.id,
                                reason: "",
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* ─ Non-salesperson: daily summary table or day drill-down ─ */}
        {!isSalesperson && !selectedDate && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-700">All Sales</h2>
              <p className="text-xs text-muted-foreground">
                Last 90 days · click a row to see transactions
              </p>
            </div>
            {dailySummaries.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                No sales recorded yet
              </div>
            ) : (
              <div className="bg-white rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left p-3 font-medium text-slate-600">
                        Date
                      </th>
                      <th className="text-center p-3 font-medium text-slate-600">
                        Sales
                      </th>
                      <th className="text-right p-3 font-medium text-slate-600">
                        Revenue
                      </th>
                      <th className="text-right p-3 font-medium text-slate-600">
                        Cash
                      </th>
                      <th className="text-right p-3 font-medium text-slate-600">
                        Mobile
                      </th>
                      <th className="text-center p-3 font-medium text-slate-600">
                        Reconciliation
                      </th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {dailySummaries.map((row) => {
                      const isToday = row.date === today;
                      const cashVar = row.cash_variance;
                      const mobileVar = row.mobile_variance;
                      const hasRecon = cashVar !== null;
                      const totalVar = (cashVar ?? 0) + (mobileVar ?? 0);

                      return (
                        <tr
                          key={row.date}
                          className="hover:bg-slate-50 cursor-pointer border-b"
                          onClick={() => openDay(row.date)}
                        >
                          <td className="p-3">
                            <span className="font-medium">
                              {formatDate(row.date)}
                            </span>
                            {isToday && (
                              <Badge
                                variant="secondary"
                                className="ml-2 text-xs"
                              >
                                Today
                              </Badge>
                            )}
                          </td>
                          <td className="p-3 text-center text-slate-600">
                            {row.count}
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {formatCurrency(row.revenue)}
                          </td>
                          <td className="p-3 text-right text-slate-600">
                            {formatCurrency(row.cash)}
                          </td>
                          <td className="p-3 text-right text-slate-600">
                            {formatCurrency(row.mobile)}
                          </td>
                          <td className="p-3 text-center">
                            {!hasRecon ? (
                              <span className="text-xs text-slate-400">
                                Not reconciled
                              </span>
                            ) : totalVar === 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                                <Minus className="h-3 w-3" /> Balanced
                              </span>
                            ) : totalVar > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                                <TrendingUp className="h-3 w-3" /> +
                                {formatCurrency(totalVar)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
                                <TrendingDown className="h-3 w-3" />{" "}
                                {formatCurrency(totalVar)}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400">
                            <ChevronRight className="h-4 w-4" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ─ Day drill-down view ─ */}
        {!isSalesperson && selectedDate && (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    setSelectedDate(null);
                    setDayDetails([]);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <div>
                  <h2 className="font-semibold text-slate-700">
                    {formatDate(selectedDate)}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {loadingDay
                      ? "Loading..."
                      : `${dayDetails.length} transaction${dayDetails.length !== 1 ? "s" : ""}`}
                  </p>
                </div>
              </div>
              {dayDetails.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-lg font-bold text-blue-600">
                    {formatCurrency(
                      dayDetails.reduce((s, r) => s + r.total_amount, 0),
                    )}
                  </p>
                </div>
              )}
            </div>

            {loadingDay ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                Loading transactions...
              </div>
            ) : dayDetails.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                No transactions found
              </div>
            ) : (
              <div className="bg-white rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-slate-600 w-24">Time</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Items</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">Qty</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">Unit Price</th>
                      <th className="text-right px-4 py-3 font-medium text-slate-600 w-28">Amount</th>
                      <th className="text-center px-4 py-3 font-medium text-slate-600 w-24">Payment</th>
                      <th className="text-left px-4 py-3 font-medium text-slate-600 w-36">Recorded by</th>
                      {(profile?.role === "supervisor" ||
                        profile?.role === "admin") && <th className="w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const canDelete = profile?.role === "supervisor" || profile?.role === "admin";
                      const colSpan = canDelete ? 8 : 7;

                      // Group sales: batch entries grouped by batch_id, individuals standalone
                      const batchMap = new Map<string, ExistingSale[]>();
                      const ordered: Array<{ type: "solo"; sale: ExistingSale } | { type: "batch"; batchId: string; sales: ExistingSale[] }> = [];
                      const seen = new Set<string>();

                      for (const sale of dayDetails) {
                        if (!sale.batch_id) {
                          ordered.push({ type: "solo", sale });
                        } else if (!seen.has(sale.batch_id)) {
                          seen.add(sale.batch_id);
                          const group = dayDetails.filter((s) => s.batch_id === sale.batch_id);
                          batchMap.set(sale.batch_id, group);
                          ordered.push({ type: "batch", batchId: sale.batch_id, sales: group });
                        }
                      }

                      const SaleRow = ({ sale, inBatch }: { sale: ExistingSale; inBatch?: boolean }) => (
                        <tr key={sale.id} className={`hover:bg-slate-50 border-b ${inBatch ? "bg-blue-50/30" : ""}`}>
                          <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                            {formatDateTime(sale.created_at).split(",")[1]?.trim() ?? formatDateTime(sale.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              {sale.items?.map((item) => {
                                const p = item.product as { name: string; unit_type: string } | null;
                                return <p key={item.id} className="text-xs">{p?.name ?? "—"}</p>;
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="space-y-1">
                              {sale.items?.map((item) => {
                                const qtyStr = item.quantity_kg > 0 ? `${item.quantity_kg} kg`
                                  : item.quantity_units > 0 ? `${item.quantity_units} units`
                                  : `${item.quantity_boxes} boxes`;
                                return <p key={item.id} className="text-xs text-slate-600">{qtyStr}</p>;
                              })}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="space-y-1">
                              {sale.items?.map((item) => (
                                <p key={item.id} className="text-xs text-slate-600">{formatCurrency(item.unit_price)}</p>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCurrency(sale.total_amount)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={sale.payment_method === "cash" ? "secondary" : "outline"} className="text-xs">
                              {sale.payment_method === "cash" ? "Cash" : "MoMo"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {(sale.recorded_by_profile as { full_name: string } | null)?.full_name ?? "—"}
                          </td>
                          {canDelete && (
                            <td className="px-2 py-3">
                              <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-600 hover:bg-red-50"
                                onClick={() => setDeleteDialog({ open: true, saleId: sale.id, reason: "" })}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      );

                      return ordered.map((entry) => {
                        if (entry.type === "solo") {
                          return <SaleRow key={entry.sale.id} sale={entry.sale} />;
                        }
                        const batchTotal = entry.sales.reduce((s, r) => s + r.total_amount, 0);
                        const recorder = (entry.sales[0].recorded_by_profile as { full_name: string } | null)?.full_name ?? "—";
                        return (
                          <React.Fragment key={entry.batchId}>
                            <tr className="bg-blue-50 border-b border-blue-100">
                              <td colSpan={colSpan} className="px-4 py-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Layers className="h-3.5 w-3.5 text-blue-500" />
                                    <span className="text-xs font-medium text-blue-700">
                                      Bulk entry · {entry.sales.length} orders · recorded by {recorder}
                                    </span>
                                  </div>
                                  <span className="text-xs font-semibold text-blue-700">{formatCurrency(batchTotal)}</span>
                                </div>
                              </td>
                            </tr>
                            {entry.sales.map((sale) => <SaleRow key={sale.id} sale={sale} inBatch />)}
                          </React.Fragment>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════
          Bulk Entry Dialog
      ═══════════════════════════════════════ */}
      <Dialog
        open={bulkOpen}
        onOpenChange={(o) => {
          if (!bulkSaving) setBulkOpen(o);
        }}
      >
        <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-4 pb-3 border-b flex-shrink-0">
            {/* Title row — pr-8 keeps it away from the absolute close button */}
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Layers className="h-4 w-4 text-blue-500" />
              Bulk Sales Entry
            </DialogTitle>

            {/* Date row — on its own line, well below the close button */}
            <div className="flex items-center gap-3 mt-2.5">
              <Label className="text-sm font-medium whitespace-nowrap">
                Sale Date
              </Label>
              <Input
                type="date"
                max={today}
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                className="h-8 text-sm w-40"
              />
              {bulkDate !== today && (
                <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                  Backdated
                </span>
              )}
              {/* <span className="text-xs text-muted-foreground">
                All orders will be recorded for this date.
              </span> */}
            </div>
          </DialogHeader>

          {/* Scrollable table area */}
          <div className="flex-1 overflow-auto px-6 py-4">
            <table className="w-full text-sm border-separate border-spacing-y-1">
              <thead>
                <tr className="text-left">
                  <th className="pb-2 font-medium text-slate-500 w-8">#</th>
                  <th className="pb-2 font-medium text-slate-500 min-w-[200px]">
                    Product *
                  </th>
                  <th className="pb-2 font-medium text-slate-500 w-28">
                    Qty (primary)
                  </th>
                  <th className="pb-2 font-medium text-slate-500 w-24">
                    Boxes
                  </th>
                  <th className="pb-2 font-medium text-slate-500 w-28">
                    Unit Price
                  </th>
                  <th className="pb-2 font-medium text-slate-500 w-28">
                    Discount
                  </th>
                  <th className="pb-2 font-medium text-slate-500 w-36">
                    Payment
                  </th>
                  <th className="pb-2 font-medium text-slate-500 w-28 text-right">
                    Total
                  </th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, idx) => {
                  const product = products.find((p) => p.id === row.product_id);
                  const result = bulkResults.find((r) => r.id === row.id);
                  const rowFailed = result && !result.ok;

                  return (
                    <tr
                      key={row.id}
                      className={`${rowFailed ? "bg-red-50 rounded-lg" : "bg-slate-50 rounded-lg"}`}
                    >
                      {/* Row number / status */}
                      <td className="pl-2 py-2 rounded-l-lg text-slate-400 text-center align-middle">
                        {result ? (
                          result.ok ? (
                            <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <span title={result.msg}>
                              <AlertCircle className="h-4 w-4 text-red-500 mx-auto" />
                            </span>
                          )
                        ) : (
                          <span className="text-xs">{idx + 1}</span>
                        )}
                      </td>

                      {/* Product */}
                      <td className="px-2 py-2 align-middle">
                        <Select
                          value={row.product_id}
                          onValueChange={(v) => onBulkProductChange(row.id, v)}
                          disabled={!!result?.ok}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select product..." />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                                <span className="ml-1 text-slate-400 text-[11px]">
                                  ({p.unit_type} ·{" "}
                                  {formatCurrency(p.selling_price)})
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>

                      {/* Qty (primary) */}
                      <td className="px-2 py-2 align-middle">
                        <Input
                          type="number"
                          min="0"
                          step={product?.unit_type === "kg" ? "0.001" : "1"}
                          placeholder={
                            product?.unit_type === "kg" ? "0.000" : "0"
                          }
                          value={row.quantity}
                          onChange={(e) =>
                            updateBulkRow(row.id, { quantity: e.target.value })
                          }
                          className="h-8 text-xs"
                          disabled={!!result?.ok}
                        />
                      </td>

                      {/* Boxes */}
                      <td className="px-2 py-2 align-middle">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={row.quantity_boxes}
                          onChange={(e) =>
                            updateBulkRow(row.id, {
                              quantity_boxes: e.target.value,
                            })
                          }
                          className="h-8 text-xs"
                          disabled={!!result?.ok}
                        />
                      </td>

                      {/* Unit price */}
                      <td className="px-2 py-2 align-middle">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={row.unit_price}
                          onChange={(e) =>
                            updateBulkRow(row.id, {
                              unit_price: e.target.value,
                            })
                          }
                          className="h-8 text-xs"
                          disabled={!!result?.ok}
                        />
                      </td>

                      {/* Discount */}
                      <td className="px-2 py-2 align-middle">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={row.discount}
                          onChange={(e) =>
                            updateBulkRow(row.id, { discount: e.target.value })
                          }
                          className="h-8 text-xs"
                          disabled={!!result?.ok}
                        />
                      </td>

                      {/* Payment method */}
                      <td className="px-2 py-2 align-middle">
                        <div className="flex rounded-md overflow-hidden border">
                          {(["cash", "mobile_money"] as PaymentMethod[]).map(
                            (m) => (
                              <button
                                key={m}
                                disabled={!!result?.ok}
                                onClick={() =>
                                  updateBulkRow(row.id, { payment_method: m })
                                }
                                className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${
                                  row.payment_method === m
                                    ? "bg-blue-600 text-white"
                                    : "bg-white text-slate-500 hover:bg-slate-50"
                                }`}
                              >
                                {m === "cash" ? "Cash" : "Mobile"}
                              </button>
                            ),
                          )}
                        </div>
                      </td>

                      {/* Line total */}
                      <td className="px-2 py-2 align-middle text-right font-semibold rounded-r-none">
                        {formatCurrency(bulkLineTotal(row, products))}
                      </td>

                      {/* Delete row */}
                      <td className="pr-2 py-2 align-middle rounded-r-lg">
                        {!result?.ok && (
                          <button
                            onClick={() => removeBulkRow(row.id)}
                            disabled={bulkRows.length === 1}
                            className="text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Add row button */}
            <button
              onClick={() => setBulkRows((rows) => [...rows, newBulkRow()])}
              className="mt-3 w-full py-2 rounded-lg border-2 border-dashed border-slate-200 text-sm text-slate-400 hover:border-blue-300 hover:text-blue-500 flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add another order
            </button>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-slate-50 flex-shrink-0 space-y-3">
            {/* Notes + totals row */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Notes for all orders (optional)"
                  value={bulkNotes}
                  onChange={(e) => setBulkNotes(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {bulkValidRows.length} valid order
                  {bulkValidRows.length !== 1 ? "s" : ""}
                </p>
                <p className="text-lg font-bold text-blue-600">
                  {formatCurrency(bulkGrandTotal)}
                </p>
              </div>
            </div>

            {/* Reconcile toggle */}
            <div className="border rounded-lg overflow-hidden">
              <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer bg-white hover:bg-slate-50 select-none">
                <input
                  type="checkbox"
                  checked={bulkReconEnabled}
                  onChange={(e) => setBulkReconEnabled(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium">
                  Reconcile this entry
                </span>
                <span className="text-xs text-slate-400 ml-1">
                  — enter actual cash & mobile collected for {bulkDate}
                </span>
              </label>

              {bulkReconEnabled &&
                (() => {
                  const sysCash = bulkValidRows
                    .filter((r) => r.payment_method === "cash")
                    .reduce((s, r) => s + bulkLineTotal(r, products), 0);
                  const sysMobile = bulkValidRows
                    .filter((r) => r.payment_method === "mobile_money")
                    .reduce((s, r) => s + bulkLineTotal(r, products), 0);
                  const actCash = parseFloat(bulkActualCash) || 0;
                  const actMobile = parseFloat(bulkActualMobile) || 0;
                  const cashVar = actCash - sysCash;
                  const mobileVar = actMobile - sysMobile;
                  return (
                    <div className="px-4 pb-4 pt-2 bg-white border-t space-y-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Actual Cash{" "}
                            <span className="text-slate-400">
                              (system: {formatCurrency(sysCash)})
                            </span>
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={bulkActualCash}
                            onChange={(e) => setBulkActualCash(e.target.value)}
                            className="h-8 text-sm"
                          />
                          {bulkActualCash && (
                            <p
                              className={`text-xs font-medium ${cashVar === 0 ? "text-green-600" : cashVar > 0 ? "text-blue-600" : "text-red-600"}`}
                            >
                              {cashVar === 0
                                ? "Balanced"
                                : cashVar > 0
                                  ? `+${formatCurrency(cashVar)} surplus`
                                  : `${formatCurrency(cashVar)} shortfall`}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Actual Mobile Money{" "}
                            <span className="text-slate-400">
                              (system: {formatCurrency(sysMobile)})
                            </span>
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={bulkActualMobile}
                            onChange={(e) =>
                              setBulkActualMobile(e.target.value)
                            }
                            className="h-8 text-sm"
                          />
                          {bulkActualMobile && (
                            <p
                              className={`text-xs font-medium ${mobileVar === 0 ? "text-green-600" : mobileVar > 0 ? "text-blue-600" : "text-red-600"}`}
                            >
                              {mobileVar === 0
                                ? "Balanced"
                                : mobileVar > 0
                                  ? `+${formatCurrency(mobileVar)} surplus`
                                  : `${formatCurrency(mobileVar)} shortfall`}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
            </div>
            <DialogFooter className="sm:justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!bulkSaving) {
                    setBulkOpen(false);
                    setBulkResults([]);
                  }
                }}
                disabled={bulkSaving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleBulkSave}
                disabled={bulkSaving || bulkValidRows.length === 0}
                className="gap-2 min-w-[160px]"
              >
                <CheckCircle className="h-4 w-4" />
                {bulkSaving
                  ? "Saving..."
                  : `Save ${bulkValidRows.length} Order${bulkValidRows.length !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Sale</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will restore the stock. Please provide a reason.
            </p>
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Input
                value={deleteDialog.reason}
                onChange={(e) =>
                  setDeleteDialog({ ...deleteDialog, reason: e.target.value })
                }
                placeholder="e.g. Customer returned, entered wrong product..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setDeleteDialog({ open: false, saleId: "", reason: "" })
              }
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete Sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
