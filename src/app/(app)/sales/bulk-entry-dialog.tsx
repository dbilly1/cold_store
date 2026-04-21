"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatCurrency } from "@/lib/utils";
import {
  Plus,
  Trash2,
  X,
  Layers,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import type { PaymentMethod, ExpenseCategory } from "@/types/database";
import type {
  Product,
  Customer,
  BulkRow,
  BulkExpenseRow,
} from "./sales-types";
import {
  EXPENSE_CATEGORIES,
  newBulkRow,
  bulkLineTotal,
} from "./sales-types";

interface BulkEntryDialogProps {
  open: boolean;
  products: Product[];
  customers: Customer[];
  profile: { id: string } | null;
  today: string;
  onClose: () => void;
  onSaved: () => void;
  onNewCustomer: (rowId: string) => void;
}

export function BulkEntryDialog({
  open,
  products,
  customers,
  profile,
  today,
  onClose,
  onSaved,
  onNewCustomer,
}: BulkEntryDialogProps) {
  const { toast } = useToast();
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([newBulkRow()]);
  const [bulkDate, setBulkDate] = useState(
    () => new Date().toISOString().split("T")[0],
  );
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResults, setBulkResults] = useState<
    { id: string; ok: boolean; msg?: string }[]
  >([]);
  const [bulkReconEnabled, setBulkReconEnabled] = useState(false);
  const [bulkActualCash, setBulkActualCash] = useState("");
  const [bulkActualMobile, setBulkActualMobile] = useState("");
  const [bulkExpenses, setBulkExpenses] = useState<BulkExpenseRow[]>([]);

  const updateBulkRow = (id: string, patch: Partial<BulkRow>) =>
    setBulkRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const removeBulkRow = (id: string) =>
    setBulkRows((rows) => rows.filter((r) => r.id !== id));

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

  const bulkGrandTotal = bulkRows.reduce(
    (s, r) => s + bulkLineTotal(r, products),
    0,
  );
  const bulkValidRows = bulkRows.filter(
    (r) =>
      r.product_id &&
      (parseFloat(r.quantity) > 0 || parseFloat(r.quantity_boxes) > 0) &&
      (r.payment_method !== "credit" || r.customer_id),
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
    try {
      const results: { id: string; ok: boolean; msg?: string }[] = [];
      const saleDate = bulkDate || today;
      const batchId = crypto.randomUUID();

      for (const row of bulkValidRows) {
        const product = products.find((p) => p.id === row.product_id);
        if (!product) {
          results.push({ id: row.id, ok: false, msg: "Product not found — refresh and retry" });
          continue;
        }
        const qty = parseFloat(row.quantity) || 0;
        const qBoxes = parseFloat(row.quantity_boxes) || 0;
        const price = parseFloat(row.unit_price) || 0;
        const disc = parseFloat(row.discount) || 0;
        const total = bulkLineTotal(row, products);

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
            customer_id:
              row.payment_method === "credit"
                ? row.customer_id || null
                : null,
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

      // Save bulk session expenses
      const validBulkExpenses = bulkExpenses.filter(
        (e) => e.description.trim() && parseFloat(e.amount) > 0,
      );
      if (validBulkExpenses.length > 0 && saved > 0) {
        const { error: expenseErr } = await supabase.from("expenses").insert(
          validBulkExpenses.map((e) => ({
            expense_date: saleDate,
            category: e.category,
            description: e.description.trim(),
            amount: parseFloat(e.amount),
            paid_from_till: true,
            recorded_by: profile!.id,
            batch_id: batchId,
          })),
        );
        if (expenseErr) {
          toast({
            title: "Sales saved — expenses not recorded",
            description: `Expense save failed: ${expenseErr.message}. Sales are intact but expenses must be entered manually.`,
            variant: "destructive",
          });
        }
      }

      const bulkExpensesTotal = validBulkExpenses.reduce(
        (s, e) => s + (parseFloat(e.amount) || 0),
        0,
      );

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
        const expectedCash = sysCash - bulkExpensesTotal;
        const status =
          actCash === expectedCash && actMobile === sysMobile
            ? "balanced"
            : "flagged";

        const { data: reconData, error: reconErr } = await supabase
          .from("daily_reconciliations")
          .upsert(
            {
              reconciliation_date: saleDate,
              submitted_by: profile!.id,
              session_key: batchId,
              system_cash_total: expectedCash,
              system_mobile_total: sysMobile,
              actual_cash_entered: actCash,
              actual_mobile_entered: actMobile,
              status,
              notes: bulkNotes || null,
            },
            { onConflict: "reconciliation_date,session_key" },
          )
          .select()
          .single();

        if (!reconErr && reconData && status === "flagged") {
          await supabase.from("alerts").insert({
            alert_type: "cash_mismatch",
            severity: "high",
            title: "Cash Reconciliation Mismatch",
            message: `Cash variance: ${formatCurrency(actCash - expectedCash)}, Mobile variance: ${formatCurrency(actMobile - sysMobile)}`,
            related_entity_type: "daily_reconciliations",
            related_entity_id: reconData.id,
          });
        }
      }

      setBulkResults(results);

      if (saved > 0) {
        onSaved();
      }

      if (failed === 0) {
        toast({
          title: `${saved} order${saved > 1 ? "s" : ""} saved${bulkReconEnabled ? " & reconciled" : ""}`,
        });
        onClose();
        setBulkRows([newBulkRow()]);
        setBulkDate(today);
        setBulkNotes("");
        setBulkResults([]);
        setBulkReconEnabled(false);
        setBulkActualCash("");
        setBulkActualMobile("");
        setBulkExpenses([]);
      } else {
        toast({
          title: `${saved} saved, ${failed} failed`,
          description: "Failed rows are highlighted — fix and retry.",
          variant: "destructive",
        });
      }
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!bulkSaving) {
          if (!o) {
            setBulkExpenses([]);
            onClose();
          }
        }
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
                <th className="pb-2 font-medium text-slate-500 w-24">Boxes</th>
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
                                ({p.unit_type} · {formatCurrency(p.selling_price)})
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
                        {(
                          ["cash", "mobile_money", "credit"] as PaymentMethod[]
                        ).map((m) => (
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
                            {m === "cash"
                              ? "Cash"
                              : m === "mobile_money"
                              ? "Mobile"
                              : "Credit"}
                          </button>
                        ))}
                      </div>
                      {row.payment_method === "credit" && (
                        <div className="flex gap-1 mt-1">
                          <Select
                            value={row.customer_id}
                            onValueChange={(v) =>
                              updateBulkRow(row.id, { customer_id: v })
                            }
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Customer..." />
                            </SelectTrigger>
                            <SelectContent>
                              {customers.map((c) => (
                                <SelectItem
                                  key={c.id}
                                  value={c.id}
                                  className="text-xs"
                                >
                                  {c.full_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="New customer"
                            onClick={() => onNewCustomer(row.id)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
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

          {/* Expenses section */}
          <div className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-white">
              <span className="text-sm font-medium">
                Session expenses (paid from till)
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 px-2"
                onClick={() =>
                  setBulkExpenses([
                    ...bulkExpenses,
                    {
                      id: crypto.randomUUID(),
                      category: "miscellaneous",
                      description: "",
                      amount: "",
                    },
                  ])
                }
              >
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {bulkExpenses.length > 0 && (
              <div className="px-4 pb-3 pt-1 bg-white border-t space-y-2">
                {bulkExpenses.map((exp) => (
                  <div key={exp.id} className="flex gap-1.5 items-center">
                    <Select
                      value={exp.category}
                      onValueChange={(v) =>
                        setBulkExpenses((prev) =>
                          prev.map((e) =>
                            e.id === exp.id
                              ? { ...e, category: v as ExpenseCategory }
                              : e,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="h-7 text-xs w-28 flex-shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPENSE_CATEGORIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      className="h-7 text-xs flex-1 min-w-0"
                      value={exp.description}
                      onChange={(e) =>
                        setBulkExpenses((prev) =>
                          prev.map((r) =>
                            r.id === exp.id
                              ? { ...r, description: e.target.value }
                              : r,
                          ),
                        )
                      }
                      placeholder="Description"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-7 text-xs w-20 flex-shrink-0"
                      value={exp.amount}
                      onChange={(e) =>
                        setBulkExpenses((prev) =>
                          prev.map((r) =>
                            r.id === exp.id
                              ? { ...r, amount: e.target.value }
                              : r,
                          ),
                        )
                      }
                      placeholder="0.00"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 flex-shrink-0"
                      onClick={() =>
                        setBulkExpenses((prev) =>
                          prev.filter((r) => r.id !== exp.id),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
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
              <span className="text-sm font-medium">Reconcile this entry</span>
              <span className="text-xs text-slate-400 ml-1">
                — enter actual cash &amp; mobile collected for {bulkDate}
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
                const expTotal = bulkExpenses.reduce(
                  (s, e) => s + (parseFloat(e.amount) || 0),
                  0,
                );
                const expectedCash = sysCash - expTotal;
                const actCash = parseFloat(bulkActualCash) || 0;
                const actMobile = parseFloat(bulkActualMobile) || 0;
                const cashVar = actCash - expectedCash;
                const mobileVar = actMobile - sysMobile;
                return (
                  <div className="px-4 pb-4 pt-2 bg-white border-t space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-xs">
                          Actual Cash{" "}
                          <span className="text-slate-400">
                            (expected: {formatCurrency(expectedCash)})
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
                  setBulkResults([]);
                  onClose();
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
  );
}
