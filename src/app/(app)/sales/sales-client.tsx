"use client";

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Plus, Trash2, ShoppingCart, X, CheckCircle } from "lucide-react";
import type { PaymentMethod } from "@/types/database";

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
  quantity: number; // in primary unit (kg or units)
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

export function SalesClient({
  products,
  initialSales,
}: {
  products: Product[];
  initialSales: ExistingSale[];
}) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [sales, setSales] = useState<ExistingSale[]>(initialSales);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [saleDiscount, setSaleDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; saleId: string; reason: string }>({
    open: false, saleId: "", reason: "",
  });
  const [selectedProductId, setSelectedProductId] = useState("");

  const addItem = () => {
    const product = products.find((p) => p.id === selectedProductId);
    if (!product) return;
    if (items.find((i) => i.product_id === product.id)) {
      toast({ title: "Product already added", variant: "destructive" });
      return;
    }
    setItems([...items, {
      product_id: product.id,
      product_name: product.name,
      unit_type: product.unit_type,
      quantity: 1,
      quantity_boxes: 0,
      unit_price: product.selling_price,
      discount: 0,
    }]);
    setSelectedProductId("");
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: keyof SaleItem, value: number | string) => {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const lineTotal = (item: SaleItem) =>
    Math.max(0, item.quantity * item.unit_price - item.discount);

  const subtotal = items.reduce((s, item) => s + lineTotal(item), 0);
  const grandTotal = Math.max(0, subtotal - saleDiscount);

  const handleSubmit = async () => {
    if (items.length === 0) {
      toast({ title: "Add at least one item", variant: "destructive" });
      return;
    }
    setSaving(true);
    const supabase = createClient();

    // Insert sale
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        sale_date: new Date().toISOString().split("T")[0],
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
      toast({ title: "Failed to save sale", description: saleError?.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Insert sale items
    const saleItems = items.map((item) => ({
      sale_id: sale.id,
      product_id: item.product_id,
      quantity_kg: item.unit_type === "kg" ? item.quantity : 0,
      quantity_units: item.unit_type === "units" ? item.quantity : 0,
      quantity_boxes: item.quantity_boxes,
      unit_price: item.unit_price,
      discount_amount: item.discount,
      line_total: lineTotal(item),
      cost_price_at_sale: products.find((p) => p.id === item.product_id)?.weighted_avg_cost ?? 0,
    }));

    const { error: itemsError } = await supabase.from("sale_items").insert(saleItems);

    if (itemsError) {
      // Rollback: delete the sale
      await supabase.from("sales").delete().eq("id", sale.id);
      toast({ title: "Failed to save items", description: itemsError.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    // Log
    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "CREATE_SALE",
      entity_type: "sales",
      entity_id: sale.id,
      new_value: { total_amount: grandTotal, items: items.length },
    });

    toast({ title: "Sale recorded", variant: "success" as never });
    setItems([]);
    setSaleDiscount(0);
    setNotes("");

    // Reload today's sales
    const { data: fresh } = await supabase
      .from("sales")
      .select(`
        id, sale_date, total_amount, discount_amount, payment_method,
        is_deleted, delete_reason, created_at,
        recorded_by_profile:profiles!sales_recorded_by_fkey(full_name),
        items:sale_items(
          id, product_id, quantity_kg, quantity_units, quantity_boxes,
          unit_price, discount_amount, line_total,
          product:products(name, unit_type)
        )
      `)
      .eq("sale_date", new Date().toISOString().split("T")[0])
      .order("created_at", { ascending: false });
    if (fresh) setSales(fresh as unknown as ExistingSale[]);
    setSaving(false);
  };

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
      toast({ title: "Failed to delete sale", description: error.message, variant: "destructive" });
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "DELETE_SALE",
      entity_type: "sales",
      entity_id: deleteDialog.saleId,
      new_value: { reason: deleteDialog.reason },
    });

    setSales(sales.map((s) => s.id === deleteDialog.saleId ? { ...s, is_deleted: true, delete_reason: deleteDialog.reason } : s));
    setDeleteDialog({ open: false, saleId: "", reason: "" });
    toast({ title: "Sale deleted", variant: "destructive" });
  };

  const activeSales = sales.filter((s) => !s.is_deleted);
  const dailyTotal = activeSales.reduce((s, sale) => s + sale.total_amount, 0);

  return (
    <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-0">
      {/* Left: New Sale Form */}
      <div className="lg:w-[420px] border-r bg-white flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-500" />
            New Sale
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Product selector */}
          <div className="flex gap-2">
            <Select value={selectedProductId} onValueChange={setSelectedProductId}>
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

          {/* Cart items */}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No items added yet
            </p>
          )}
          {items.map((item, idx) => (
            <Card key={item.product_id} className="p-3">
              <div className="flex items-start justify-between mb-2">
                <p className="font-medium text-sm">{item.product_name}</p>
                <button onClick={() => removeItem(idx)} className="text-slate-400 hover:text-red-500">
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
                    onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
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
                    onChange={(e) => updateItem(idx, "unit_price", parseFloat(e.target.value) || 0)}
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
                    onChange={(e) => updateItem(idx, "quantity_boxes", parseInt(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Item Discount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount}
                    onChange={(e) => updateItem(idx, "discount", parseFloat(e.target.value) || 0)}
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

        {/* Footer / totals */}
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
            <span className="text-blue-600 text-lg">{formatCurrency(grandTotal)}</span>
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

          <Button onClick={handleSubmit} className="w-full" disabled={saving || items.length === 0}>
            {saving ? "Saving..." : `Record Sale — ${formatCurrency(grandTotal)}`}
          </Button>
        </div>
      </div>

      {/* Right: Today's Sales */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-700">
            Today&apos;s Sales
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({activeSales.length} transactions)
            </span>
          </h2>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(dailyTotal)}</p>
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
                        <span className="font-semibold">{formatCurrency(sale.total_amount)}</span>
                        <Badge variant={sale.payment_method === "cash" ? "secondary" : "outline"}>
                          {sale.payment_method === "cash" ? "Cash" : "Mobile Money"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(sale.created_at)} ·{" "}
                        {(sale.recorded_by_profile as { full_name: string } | null)?.full_name}
                      </p>
                      <div className="mt-2 space-y-0.5">
                        {sale.items?.map((item) => (
                          <p key={item.id} className="text-xs text-slate-600">
                            {(item.product as { name: string; unit_type: string } | null)?.name} ·{" "}
                            {item.quantity_kg > 0 ? `${item.quantity_kg} kg` : `${item.quantity_units} units`}
                            {item.quantity_boxes > 0 ? ` + ${item.quantity_boxes} boxes` : ""} ·{" "}
                            {formatCurrency(item.line_total)}
                          </p>
                        ))}
                      </div>
                    </div>
                    {(profile?.role === "salesperson" || profile?.role === "supervisor" || profile?.role === "admin") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteDialog({ open: true, saleId: sale.id, reason: "" })}
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
      </div>

      {/* Delete dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
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
                onChange={(e) => setDeleteDialog({ ...deleteDialog, reason: e.target.value })}
                placeholder="e.g. Customer returned, entered wrong product..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, saleId: "", reason: "" })}>
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
