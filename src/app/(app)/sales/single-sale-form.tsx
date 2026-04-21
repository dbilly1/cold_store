"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { Plus, ShoppingCart, X, Layers, CalendarDays } from "lucide-react";
import type { PaymentMethod } from "@/types/database";
import type { Product, SaleItem, Customer } from "./sales-types";
import { lineTotal, refreshSales } from "./sales-types";

interface SingleSaleFormProps {
  products: Product[];
  customers: Customer[];
  profile: { id: string; role?: string } | null;
  today: string;
  canBulkEntry: boolean;
  creditCustomerId: string;
  onCreditCustomerChange: (id: string) => void;
  onNewCustomer: () => void;
  onSaleRecorded: (date: string) => void;
  onBulkOpen: () => void;
}

export function SingleSaleForm({
  products,
  customers,
  profile,
  today,
  canBulkEntry,
  creditCustomerId,
  onCreditCustomerChange,
  onNewCustomer,
  onSaleRecorded,
  onBulkOpen,
}: SingleSaleFormProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [saleDiscount, setSaleDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [saleDate, setSaleDate] = useState(today);

  const isAdmin = profile?.role === "admin" || profile?.role === "supervisor";
  const isBackdated = saleDate !== today;

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
        units_per_box: product.units_per_box ?? 0,
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
    if (paymentMethod === "credit" && !creditCustomerId) {
      toast({
        title: "Customer required",
        description: "Select or add a customer before recording a credit sale.",
        variant: "destructive",
      });
      return;
    }
    const missingProduct = items.find(
      (item) => !products.find((p) => p.id === item.product_id),
    );
    if (missingProduct) {
      toast({
        title: "Product data missing",
        description: `"${missingProduct.product_name}" was not found. Refresh the page and try again.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();

      const { data: sale, error: saleError } = await supabase
        .from("sales")
        .insert({
          sale_date: saleDate,
          recorded_by: profile!.id,
          total_amount: grandTotal,
          discount_amount: saleDiscount,
          payment_method: paymentMethod,
          notes: notes || null,
          is_deleted: false,
          customer_id:
            paymentMethod === "credit" ? creditCustomerId || null : null,
        })
        .select()
        .single();

      if (saleError || !sale) {
        toast({
          title: "Failed to save sale",
          description: saleError?.message,
          variant: "destructive",
        });
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
          products.find((p) => p.id === item.product_id)?.weighted_avg_cost ??
          0,
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
        return;
      }

      await supabase.from("audit_logs").insert({
        user_id: profile!.id,
        action: "CREATE_SALE",
        entity_type: "sales",
        entity_id: sale.id,
        new_value: { total_amount: grandTotal, items: items.length },
      });

      const savedDate = saleDate;
      toast({ title: isBackdated ? `Sale recorded for ${savedDate}` : "Sale recorded" });
      setItems([]);
      setSaleDiscount(0);
      setNotes("");
      setSaleDate(today);
      onCreditCustomerChange("");
      onSaleRecorded(savedDate);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lg:w-[420px] border-r bg-white flex flex-col lg:h-full lg:overflow-hidden">
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
            onClick={onBulkOpen}
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
                    updateItem(idx, "quantity", parseFloat(e.target.value) || 0)
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
              {item.units_per_box > 0 && item.unit_type !== "boxes" && (
                <div>
                  <Label className="text-xs">
                    Boxes
                    <span className="text-slate-400 font-normal ml-1">
                      ({item.units_per_box} {item.unit_type}/box)
                    </span>
                  </Label>
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
                  {item.quantity_boxes > 0 && (
                    <p className="text-xs text-blue-600 mt-0.5">
                      = {item.quantity_boxes * item.units_per_box} {item.unit_type}
                    </p>
                  )}
                </div>
              )}
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
            {(["cash", "mobile_money", "credit"] as PaymentMethod[]).map(
              (m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    paymentMethod === m
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {m === "cash"
                    ? "Cash"
                    : m === "mobile_money"
                    ? "Mobile Money"
                    : "Credit"}
                </button>
              ),
            )}
          </div>
          {paymentMethod === "credit" && (
            <div className="flex gap-2 mt-1">
              <Select
                value={creditCustomerId}
                onValueChange={onCreditCustomerChange}
              >
                <SelectTrigger className="flex-1 text-sm">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="outline"
                title="New customer"
                onClick={onNewCustomer}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        {isAdmin && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              <Label className="text-xs">Sale Date</Label>
              {isBackdated && (
                <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  Backdated
                </span>
              )}
            </div>
            <Input
              type="date"
              max={today}
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value || today)}
              className="h-8 text-sm"
            />
          </div>
        )}
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
          {saving ? "Saving..." : `Record Sale — ${formatCurrency(grandTotal)}`}
        </Button>
      </div>
    </div>
  );
}
