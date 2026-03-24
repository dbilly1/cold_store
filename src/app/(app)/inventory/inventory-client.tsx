"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatCurrency, formatWeight } from "@/lib/utils";
import { Plus, Package, TrendingUp, Edit, PlusCircle, Search } from "lucide-react";
import type { UnitType } from "@/types/database";

interface Category { id: string; name: string; }
interface Product {
  id: string;
  name: string;
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
  category: { id: string; name: string } | null;
}

const emptyProduct = {
  name: "", category_id: "", unit_type: "kg" as UnitType,
  units_per_box: "", selling_price: "", low_stock_threshold: "10",
  variance_threshold_pct: "5",
};

const emptyRestock = {
  quantity_kg: "", quantity_units: "", quantity_boxes: "",
  cost_price_per_unit: "", supplier: "", notes: "",
};

export function InventoryClient({ products: initial, categories }: { products: Product[]; categories: Category[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [products, setProducts] = useState<Product[]>(initial);
  const [search, setSearch] = useState("");
  const [productForm, setProductForm] = useState(emptyProduct);
  const [restockForm, setRestockForm] = useState(emptyRestock);
  const [productDialog, setProductDialog] = useState(false);
  const [restockDialog, setRestockDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = profile?.role === "admin" || profile?.role === "supervisor";

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category?.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleSaveProduct() {
    if (!productForm.name.trim()) {
      toast({ title: "Product name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const payload = {
      name: productForm.name.trim(),
      category_id: productForm.category_id || null,
      unit_type: productForm.unit_type,
      units_per_box: productForm.units_per_box ? parseFloat(productForm.units_per_box) : null,
      selling_price: parseFloat(productForm.selling_price) || 0,
      low_stock_threshold: parseFloat(productForm.low_stock_threshold) || 10,
      variance_threshold_pct: parseFloat(productForm.variance_threshold_pct) || 5,
      is_active: true,
    };

    if (editProduct) {
      const { data, error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", editProduct.id)
        .select(`*, category:categories(id, name)`)
        .single();

      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else {
        setProducts(products.map((p) => p.id === editProduct.id ? data as Product : p));
        await supabase.from("audit_logs").insert({ user_id: profile!.id, action: "UPDATE_PRODUCT", entity_type: "products", entity_id: editProduct.id, new_value: payload });
        toast({ title: "Product updated" });
      }
    } else {
      const { data, error } = await supabase
        .from("products")
        .insert({ ...payload, current_stock_kg: 0, current_stock_units: 0, current_stock_boxes: 0, weighted_avg_cost: 0 })
        .select(`*, category:categories(id, name)`)
        .single();

      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else {
        setProducts([...products, data as Product]);
        await supabase.from("audit_logs").insert({ user_id: profile!.id, action: "CREATE_PRODUCT", entity_type: "products", entity_id: data.id, new_value: payload });
        toast({ title: "Product created" });
      }
    }

    setProductDialog(false);
    setEditProduct(null);
    setProductForm(emptyProduct);
    setSaving(false);
  }

  async function handleRestock() {
    if (!restockDialog.product) return;
    const cost = parseFloat(restockForm.cost_price_per_unit);
    if (!cost || cost <= 0) {
      toast({ title: "Cost price required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const qKg = parseFloat(restockForm.quantity_kg) || 0;
    const qUnits = parseFloat(restockForm.quantity_units) || 0;
    const qBoxes = parseFloat(restockForm.quantity_boxes) || 0;
    const p = restockDialog.product;
    const primaryQty = p.unit_type === "kg"
      ? qKg + qBoxes * (p.units_per_box ?? 0)
      : qUnits + qBoxes * (p.units_per_box ?? 0);
    const totalCost = primaryQty * cost;

    const { error } = await supabase.from("stock_additions").insert({
      product_id: p.id,
      added_by: profile!.id,
      quantity_kg: qKg,
      quantity_units: qUnits,
      quantity_boxes: qBoxes,
      cost_price_per_unit: cost,
      total_cost: totalCost,
      supplier: restockForm.supplier || null,
      notes: restockForm.notes || null,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Stock added successfully" });
      await supabase.from("audit_logs").insert({
        user_id: profile!.id, action: "ADD_STOCK", entity_type: "products",
        entity_id: p.id, new_value: { quantity_kg: qKg, quantity_units: qUnits, quantity_boxes: qBoxes, cost },
      });
      // Refresh products
      const { data } = await supabase
        .from("products")
        .select(`*, category:categories(id, name)`)
        .order("name");
      if (data) setProducts(data as Product[]);
    }

    setRestockDialog({ open: false, product: null });
    setRestockForm(emptyRestock);
    setSaving(false);
  }

  const openEdit = (product: Product) => {
    setEditProduct(product);
    setProductForm({
      name: product.name,
      category_id: product.category?.id ?? "",
      unit_type: product.unit_type,
      units_per_box: product.units_per_box?.toString() ?? "",
      selling_price: product.selling_price.toString(),
      low_stock_threshold: product.low_stock_threshold.toString(),
      variance_threshold_pct: product.variance_threshold_pct.toString(),
    });
    setProductDialog(true);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        {canEdit && (
          <Button onClick={() => { setEditProduct(null); setProductForm(emptyProduct); setProductDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" />
            Add Product
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{products.filter(p => p.is_active).length}</p>
              <p className="text-xs text-muted-foreground">Active Products</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-amber-500" />
            <div>
              <p className="text-2xl font-bold">{products.filter(p => p.current_stock_kg <= p.low_stock_threshold && p.is_active).length}</p>
              <p className="text-xs text-muted-foreground">Low Stock</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">
                {formatCurrency(products.reduce((s, p) => s + (p.current_stock_kg * p.weighted_avg_cost), 0))}
              </p>
              <p className="text-xs text-muted-foreground">Stock Value</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Products table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 font-medium text-slate-600">Product</th>
              <th className="text-left p-3 font-medium text-slate-600">Category</th>
              <th className="text-right p-3 font-medium text-slate-600">Stock (Kg/Units)</th>
              <th className="text-right p-3 font-medium text-slate-600">Boxes</th>
              <th className="text-right p-3 font-medium text-slate-600">Avg Cost</th>
              <th className="text-right p-3 font-medium text-slate-600">Sell Price</th>
              <th className="text-center p-3 font-medium text-slate-600">Status</th>
              {canEdit && <th className="text-center p-3 font-medium text-slate-600">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((product) => {
              const stock = product.unit_type === "kg"
                ? `${product.current_stock_kg.toFixed(3)} kg`
                : `${product.current_stock_units} units`;
              const isLow = product.unit_type === "kg"
                ? product.current_stock_kg <= product.low_stock_threshold
                : product.current_stock_units <= product.low_stock_threshold;
              const margin = product.weighted_avg_cost > 0
                ? ((product.selling_price - product.weighted_avg_cost) / product.selling_price * 100).toFixed(1)
                : "—";

              return (
                <tr key={product.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-slate-400">{product.unit_type}</p>
                  </td>
                  <td className="p-3 text-slate-600">{product.category?.name ?? "—"}</td>
                  <td className="p-3 text-right">
                    <span className={isLow ? "text-red-600 font-semibold" : ""}>{stock}</span>
                  </td>
                  <td className="p-3 text-right">{product.current_stock_boxes}</td>
                  <td className="p-3 text-right">{formatCurrency(product.weighted_avg_cost)}</td>
                  <td className="p-3 text-right">
                    <div>{formatCurrency(product.selling_price)}</div>
                    <div className="text-xs text-green-600">{margin}% margin</div>
                  </td>
                  <td className="p-3 text-center">
                    {isLow
                      ? <Badge variant="destructive">Low</Badge>
                      : <Badge variant="success">OK</Badge>
                    }
                  </td>
                  {canEdit && (
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(product)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-green-600 hover:text-green-700"
                          onClick={() => setRestockDialog({ open: true, product })}>
                          <PlusCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No products found
          </div>
        )}
      </div>

      {/* Product Dialog */}
      <Dialog open={productDialog} onOpenChange={setProductDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editProduct ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={productForm.category_id} onValueChange={(v) => setProductForm({ ...productForm, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unit Type</Label>
                <Select value={productForm.unit_type} onValueChange={(v) => setProductForm({ ...productForm, unit_type: v as UnitType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">Weight (kg)</SelectItem>
                    <SelectItem value="units">Units</SelectItem>
                    <SelectItem value="boxes">Boxes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Units Per Box</Label>
                <Input type="number" value={productForm.units_per_box} onChange={(e) => setProductForm({ ...productForm, units_per_box: e.target.value })} placeholder="e.g. 12" />
              </div>
              <div>
                <Label>Selling Price *</Label>
                <Input type="number" value={productForm.selling_price} onChange={(e) => setProductForm({ ...productForm, selling_price: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Low Stock Threshold</Label>
                <Input type="number" value={productForm.low_stock_threshold} onChange={(e) => setProductForm({ ...productForm, low_stock_threshold: e.target.value })} />
              </div>
              <div>
                <Label>Variance % Threshold</Label>
                <Input type="number" value={productForm.variance_threshold_pct} onChange={(e) => setProductForm({ ...productForm, variance_threshold_pct: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveProduct} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restock Dialog */}
      <Dialog open={restockDialog.open} onOpenChange={(open) => setRestockDialog({ ...restockDialog, open })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Stock — {restockDialog.product?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>Qty (kg)</Label>
                <Input type="number" min="0" step="0.001" value={restockForm.quantity_kg} onChange={(e) => setRestockForm({ ...restockForm, quantity_kg: e.target.value })} />
              </div>
              <div>
                <Label>Units</Label>
                <Input type="number" min="0" value={restockForm.quantity_units} onChange={(e) => setRestockForm({ ...restockForm, quantity_units: e.target.value })} />
              </div>
              <div>
                <Label>Boxes</Label>
                <Input type="number" min="0" value={restockForm.quantity_boxes} onChange={(e) => setRestockForm({ ...restockForm, quantity_boxes: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Cost Price (per unit/kg) *</Label>
              <Input type="number" min="0" step="0.01" value={restockForm.cost_price_per_unit} onChange={(e) => setRestockForm({ ...restockForm, cost_price_per_unit: e.target.value })} />
            </div>
            <div>
              <Label>Supplier</Label>
              <Input value={restockForm.supplier} onChange={(e) => setRestockForm({ ...restockForm, supplier: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={restockForm.notes} onChange={(e) => setRestockForm({ ...restockForm, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestockDialog({ open: false, product: null })}>Cancel</Button>
            <Button onClick={handleRestock} disabled={saving}>{saving ? "Saving..." : "Add Stock"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
