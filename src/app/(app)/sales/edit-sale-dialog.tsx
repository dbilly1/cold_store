"use client";

import React from "react";
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
import { Plus } from "lucide-react";
import type { PaymentMethod } from "@/types/database";
import type { EditDialogState, EditItem, Customer, Product } from "./sales-types";

interface EditSaleDialogProps {
  dialog: EditDialogState;
  customers: Customer[];
  products: Product[];
  profile: { id: string } | null;
  isSalesperson: boolean;
  selectedDate: string | null;
  onClose: () => void;
  onChange: (patch: Partial<EditDialogState>) => void;
  onItemChange: (idx: number, patch: Partial<EditItem>) => void;
  onSave: () => void;
  saving: boolean;
  onNewCustomer: () => void;
}

export function EditSaleDialog({
  dialog,
  customers,
  onClose,
  onChange,
  onItemChange,
  onSave,
  saving,
  onNewCustomer,
}: EditSaleDialogProps) {
  return (
    <Dialog
      open={dialog.open}
      onOpenChange={(open) => onChange({ open })}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Sale</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={dialog.sale_date}
                onChange={(e) => onChange({ sale_date: e.target.value })}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Payment Method</Label>
              <Select
                value={dialog.paymentMethod}
                onValueChange={(v) =>
                  onChange({
                    paymentMethod: v as PaymentMethod,
                    customer_id: v !== "credit" ? "" : dialog.customer_id,
                  })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Customer (credit only) */}
          {dialog.paymentMethod === "credit" && (
            <div>
              <Label className="text-xs">Customer *</Label>
              <div className="flex gap-2 mt-1">
                <Select
                  value={dialog.customer_id}
                  onValueChange={(v) => onChange({ customer_id: v })}
                >
                  <SelectTrigger className="h-8 text-sm flex-1">
                    <SelectValue placeholder="Select customer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name}{c.phone ? ` · ${c.phone}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  title="New customer"
                  onClick={onNewCustomer}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Items */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Items</Label>
            {dialog.items.map((item, idx) => {
              const price = parseFloat(item.unit_price) || 0;
              const disc = parseFloat(item.discount_amount) || 0;
              const qty = parseFloat(item.quantity) || 0;
              const lt = Math.max(0, qty * price - disc);
              return (
                <div key={item.id} className="bg-slate-50 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-700">
                    {item.productName}
                    <span className="font-normal text-slate-400 ml-1">({item.unit_type})</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Qty ({item.unit_type})</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        className="h-7 text-sm"
                        value={item.quantity}
                        onChange={(e) => onItemChange(idx, { quantity: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Unit Price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-7 text-sm"
                        value={item.unit_price}
                        onChange={(e) => onItemChange(idx, { unit_price: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Discount</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="h-7 text-sm"
                        value={item.discount_amount}
                        onChange={(e) => onItemChange(idx, { discount_amount: e.target.value })}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-right text-slate-500">
                    Line total:{" "}
                    <span className="font-semibold text-slate-700">{formatCurrency(lt)}</span>
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between items-center pt-1 border-t text-sm font-semibold">
            <span>New Total</span>
            <span className="text-blue-600">
              {formatCurrency(
                dialog.items.reduce((s, item) => {
                  const qty = parseFloat(item.quantity) || 0;
                  const qBoxes =
                    item.unit_type === "boxes"
                      ? qty
                      : parseFloat(item.quantity_boxes) || 0;
                  const price = parseFloat(item.unit_price) || 0;
                  const disc = parseFloat(item.discount_amount) || 0;
                  const effectiveQty = item.unit_type === "boxes" ? qBoxes : qty;
                  return s + Math.max(0, effectiveQty * price - disc);
                }, 0),
              )}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
