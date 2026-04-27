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
import { formatCurrency } from "@/lib/utils";
import { Plus, Package, TrendingUp, Edit, PlusCircle, Search, Truck, Trash2, ArrowUpDown, X } from "lucide-react";
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
  // Opening stock (only used on create)
  opening_qty: "", opening_boxes: "", opening_cost: "",
  // WAC override (only used on edit)
  override_wac: "",
};

const emptyRestock = {
  quantity_primary: "", quantity_boxes: "",
  cost_price_per_unit: "", supplier: "", notes: "",
};

interface BulkRestockRow {
  rowId: string;
  product_id: string;
  quantity_primary: string;
  quantity_boxes: string;
  cost_per_box: string;  // user enters cost per box; saved as cost per primary unit
  supplier: string;
}

function emptyBulkRow(): BulkRestockRow {
  return {
    rowId: crypto.randomUUID(),
    product_id: "",
    quantity_primary: "",
    quantity_boxes: "",
    cost_per_box: "",
    supplier: "",
  };
}

type SortOption =
  | "name-asc"
  | "name-desc"
  | "stock-asc"
  | "stock-desc"
  | "low-stock-first"
  | "value-desc"
  | "category";

/** Returns the numeric stock quantity used for sorting */
function stockQty(p: Product): number {
  if (p.unit_type === "kg")    return p.current_stock_kg;
  if (p.unit_type === "units") return p.current_stock_units;
  return p.current_stock_boxes;
}

/** Returns the primary stock label and value for a product */
function stockDisplay(p: Product) {
  if (p.unit_type === "kg") return `${Number(p.current_stock_kg).toFixed(3)} kg`;
  if (p.unit_type === "units") return `${Number(p.current_stock_units)} units`;
  return `${Number(p.current_stock_boxes)} boxes`;
}

function isLowStock(p: Product) {
  if (p.unit_type === "kg") return p.current_stock_kg <= p.low_stock_threshold;
  if (p.unit_type === "units") return p.current_stock_units <= p.low_stock_threshold;
  return p.current_stock_boxes <= p.low_stock_threshold;
}

export function InventoryClient({ products: initial, categories }: { products: Product[]; categories: Category[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [products, setProducts] = useState<Product[]>(initial);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [productForm, setProductForm] = useState(emptyProduct);
  const [restockForm, setRestockForm] = useState(emptyRestock);
  const [productDialog, setProductDialog] = useState(false);
  const [restockDialog, setRestockDialog] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkRestockDialog, setBulkRestockDialog] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRestockRow[]>(() => [emptyBulkRow()]);
  const [bulkSaving, setBulkSaving] = useState(false);

  const canEdit = profile?.role === "admin" || profile?.role === "supervisor";

  const filtered = products
    .filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.category?.name ?? "").toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "stock-asc":
          return stockQty(a) - stockQty(b);
        case "stock-desc":
          return stockQty(b) - stockQty(a);
        case "low-stock-first": {
          const aLow = isLowStock(a) ? 0 : 1;
          const bLow = isLowStock(b) ? 0 : 1;
          return aLow !== bLow ? aLow - bLow : stockQty(a) - stockQty(b);
        }
        case "value-desc": {
          const aVal = stockQty(a) * a.weighted_avg_cost;
          const bVal = stockQty(b) * b.weighted_avg_cost;
          return bVal - aVal;
        }
        case "category": {
          const aCat = a.category?.name ?? "zzz";
          const bCat = b.category?.name ?? "zzz";
          return aCat.localeCompare(bCat) || a.name.localeCompare(b.name);
        }
        default:
          return 0;
      }
    });

  // ---------- Save Product ----------
  async function handleSaveProduct() {
    if (!productForm.name.trim()) {
      toast({ title: "Product name required", variant: "destructive" });
      return;
    }
    const hasOpeningStock = !editProduct && (
      parseFloat(productForm.opening_qty) > 0 ||
      parseFloat(productForm.opening_boxes) > 0
    );
    if (hasOpeningStock && !parseFloat(productForm.opening_cost)) {
      toast({ title: "Cost price required when adding opening stock", variant: "destructive" });
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
      const wacOverride = parseFloat(productForm.override_wac);
      const updatePayload = {
        ...payload,
        ...(wacOverride > 0 ? { weighted_avg_cost: wacOverride } : {}),
      };
      const { data, error } = await supabase
        .from("products")
        .update(updatePayload)
        .eq("id", editProduct.id)
        .select(`id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, weighted_avg_cost, selling_price, low_stock_threshold, variance_threshold_pct, is_active, created_at, category:categories(id, name)`)
        .single();

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      } else {
        setProducts(products.map((p) => p.id === editProduct.id ? data as unknown as Product : p));
        await supabase.from("audit_logs").insert({
          user_id: profile!.id, action: "UPDATE_PRODUCT",
          entity_type: "products", entity_id: editProduct.id,
          new_value: { ...payload, ...(wacOverride > 0 ? { weighted_avg_cost_override: wacOverride } : {}) },
        });
        toast({ title: "Product updated" });
      }
    } else {
      const { data, error } = await supabase
        .from("products")
        .insert({ ...payload, current_stock_kg: 0, current_stock_units: 0, current_stock_boxes: 0, weighted_avg_cost: 0 })
        .select(`id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, weighted_avg_cost, selling_price, low_stock_threshold, variance_threshold_pct, is_active, created_at, category:categories(id, name)`)
        .single();

      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }

      const newProduct = data as unknown as Product;

      // Insert opening stock if provided
      if (hasOpeningStock) {
        const qPrimary = parseFloat(productForm.opening_qty) || 0;
        const qBoxes = parseFloat(productForm.opening_boxes) || 0;
        const cost = parseFloat(productForm.opening_cost);
        const primaryQty = qPrimary + qBoxes * (newProduct.units_per_box ?? 0);
        const totalCost = primaryQty * cost;

        const stockEntry = {
          product_id: newProduct.id,
          added_by: profile!.id,
          quantity_kg: productForm.unit_type === "kg" ? qPrimary : 0,
          quantity_units: productForm.unit_type === "units" ? qPrimary : 0,
          quantity_boxes: qBoxes,
          cost_price_per_unit: cost,
          total_cost: totalCost || cost * qBoxes,
          notes: "Opening stock",
        };

        const { error: stockError } = await supabase.from("stock_additions").insert(stockEntry);
        if (stockError) {
          toast({ title: "Product created but opening stock failed — rolling back", description: stockError.message, variant: "destructive" });
          // Rollback: delete the newly created product so state stays consistent
          await supabase.from("products").delete().eq("id", newProduct.id);
          setProductDialog(false);
          setEditProduct(null);
          setProductForm(emptyProduct);
          setSaving(false);
          return;
        } else {
          // Re-fetch updated product with fresh stock values
          const { data: fresh } = await supabase
            .from("products").select(`id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, weighted_avg_cost, selling_price, low_stock_threshold, variance_threshold_pct, is_active, created_at, category:categories(id, name)`).eq("id", newProduct.id).single();
          setProducts([...products, (fresh ?? newProduct) as unknown as Product]);
          await supabase.from("audit_logs").insert({
            user_id: profile!.id, action: "CREATE_PRODUCT",
            entity_type: "products", entity_id: newProduct.id,
            new_value: { ...payload, opening_qty: qPrimary, opening_boxes: qBoxes, opening_cost: cost },
          });
          toast({ title: "Product created with opening stock" });
          setProductDialog(false);
          setEditProduct(null);
          setProductForm(emptyProduct);
          setSaving(false);
          return;
        }
      }

      setProducts([...products, newProduct]);
      await supabase.from("audit_logs").insert({
        user_id: profile!.id, action: "CREATE_PRODUCT",
        entity_type: "products", entity_id: newProduct.id, new_value: payload,
      });
      toast({ title: "Product created" });
    }

    setProductDialog(false);
    setEditProduct(null);
    setProductForm(emptyProduct);
    setSaving(false);
  }

  // ---------- Restock ----------
  async function handleRestock() {
    if (!restockDialog.product) return;
    const cost = parseFloat(restockForm.cost_price_per_unit);
    if (!cost || cost <= 0) {
      toast({ title: "Cost price required", variant: "destructive" });
      return;
    }
    const qPrimary = parseFloat(restockForm.quantity_primary) || 0;
    const qBoxes = parseFloat(restockForm.quantity_boxes) || 0;
    if (qPrimary <= 0 && qBoxes <= 0) {
      toast({ title: "Enter at least one quantity", variant: "destructive" });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const p = restockDialog.product;
    const primaryQty = qPrimary + qBoxes * (p.units_per_box ?? 0);
    const totalCost = primaryQty * cost;

    const { error } = await supabase.from("stock_additions").insert({
      product_id: p.id,
      added_by: profile!.id,
      quantity_kg: p.unit_type === "kg" ? qPrimary : 0,
      quantity_units: p.unit_type === "units" ? qPrimary : 0,
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
        entity_id: p.id,
        new_value: { quantity_primary: qPrimary, quantity_boxes: qBoxes, cost, unit_type: p.unit_type },
      });
      const { data } = await supabase.from("products").select(`id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, weighted_avg_cost, selling_price, low_stock_threshold, variance_threshold_pct, is_active, created_at, category:categories(id, name)`).order("name");
      if (data) setProducts(data as unknown as Product[]);
    }

    setRestockDialog({ open: false, product: null });
    setRestockForm(emptyRestock);
    setSaving(false);
  }

  // ---------- Bulk Restock ----------
  async function handleBulkRestock() {
    // Validate
    for (const row of bulkRows) {
      if (!row.product_id) {
        toast({ title: "Select a product for each row", variant: "destructive" });
        return;
      }
      const cost = parseFloat(row.cost_per_box);
      if (!cost || cost <= 0) {
        toast({ title: "Cost price required for each row", variant: "destructive" });
        return;
      }
      const qPrimary = parseFloat(row.quantity_primary) || 0;
      const qBoxes = parseFloat(row.quantity_boxes) || 0;
      if (qPrimary <= 0 && qBoxes <= 0) {
        toast({ title: "Enter at least one quantity per row", variant: "destructive" });
        return;
      }
    }

    setBulkSaving(true);
    const supabase = createClient();

    const inserts = bulkRows.map((row) => {
      const p = products.find((pr) => pr.id === row.product_id)!;
      const qPrimary = parseFloat(row.quantity_primary) || 0;
      const qBoxes = parseFloat(row.quantity_boxes) || 0;
      const costPerBox = parseFloat(row.cost_per_box) || 0;
      const upb = p.units_per_box ?? 0;
      // Convert cost/box → cost/primary-unit for WAC calculation.
      // For "boxes" products and products without a box conversion, cost/box IS cost/unit.
      const costPerUnit = upb > 0 && p.unit_type !== "boxes"
        ? costPerBox / upb
        : costPerBox;
      const primaryQty = p.unit_type === "boxes"
        ? qBoxes
        : qPrimary + qBoxes * upb;
      const totalCost = primaryQty * costPerUnit;
      return {
        product_id: p.id,
        added_by: profile!.id,
        quantity_kg: p.unit_type === "kg" ? qPrimary : 0,
        quantity_units: p.unit_type === "units" ? qPrimary : 0,
        quantity_boxes: qBoxes,
        cost_price_per_unit: costPerUnit,
        total_cost: totalCost,
        supplier: row.supplier.trim() || null,
        notes: null,
      };
    });

    const { error } = await supabase.from("stock_additions").insert(inserts);

    if (error) {
      toast({ title: "Error saving bulk restock", description: error.message, variant: "destructive" });
    } else {
      toast({ title: `${inserts.length} restock(s) saved successfully` });
      // Re-fetch all products
      const { data } = await supabase.from("products").select(`id, name, unit_type, units_per_box, current_stock_kg, current_stock_units, current_stock_boxes, weighted_avg_cost, selling_price, low_stock_threshold, variance_threshold_pct, is_active, created_at, category:categories(id, name)`).order("name");
      if (data) setProducts(data as unknown as Product[]);
      setBulkRestockDialog(false);
      setBulkRows([emptyBulkRow()]);
    }

    setBulkSaving(false);
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
      opening_qty: "", opening_boxes: "", opening_cost: "", override_wac: "",
    });
    setProductDialog(true);
  };

  // Label helpers based on unit type
  const primaryLabel = (ut: UnitType) => ut === "kg" ? "kg" : ut === "units" ? "units" : "boxes";
  const restockProduct = restockDialog.product;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-44 h-9 text-sm gap-1">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name: A → Z</SelectItem>
              <SelectItem value="name-desc">Name: Z → A</SelectItem>
              <SelectItem value="stock-asc">Stock: Low → High</SelectItem>
              <SelectItem value="stock-desc">Stock: High → Low</SelectItem>
              <SelectItem value="low-stock-first">Low Stock First</SelectItem>
              <SelectItem value="value-desc">Stock Value: High → Low</SelectItem>
              <SelectItem value="category">By Category</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { setBulkRows([emptyBulkRow()]); setBulkRestockDialog(true); }}>
              <Truck className="h-4 w-4 mr-1" />
              Bulk Restock
            </Button>
            <Button onClick={() => { setEditProduct(null); setProductForm(emptyProduct); setProductDialog(true); }}>
              <Plus className="h-4 w-4 mr-1" />
              Add Product
            </Button>
          </div>
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
              <p className="text-2xl font-bold">{products.filter(p => isLowStock(p) && p.is_active).length}</p>
              <p className="text-xs text-muted-foreground">Low Stock</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">
                {formatCurrency(products.reduce((s, p) => {
                  const qty =
                    p.unit_type === "kg"    ? p.current_stock_kg :
                    p.unit_type === "units" ? p.current_stock_units :
                                             p.current_stock_boxes;
                  return s + qty * p.weighted_avg_cost;
                }, 0))}
              </p>
              <p className="text-xs text-muted-foreground">Stock Value</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Products table */}
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 font-medium text-slate-600">Product</th>
              <th className="text-left p-3 font-medium text-slate-600">Category</th>
              <th className="text-right p-3 font-medium text-slate-600">Stock</th>
              <th className="text-right p-3 font-medium text-slate-600">Est. Boxes</th>
              <th className="text-right p-3 font-medium text-slate-600">Avg Cost</th>
              <th className="text-right p-3 font-medium text-slate-600">Sell Price</th>
              <th className="text-center p-3 font-medium text-slate-600">Status</th>
              {canEdit && <th className="text-center p-3 font-medium text-slate-600">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((product) => {
              const low = isLowStock(product);
              const margin = product.weighted_avg_cost > 0
                ? ((product.selling_price - product.weighted_avg_cost) / product.selling_price * 100).toFixed(1)
                : "—";

              return (
                <tr key={product.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-slate-400 capitalize">{product.unit_type}</p>
                  </td>
                  <td className="p-3 text-slate-600">{product.category?.name ?? "—"}</td>
                  <td className="p-3 text-right">
                    <span className={low ? "text-red-600 font-semibold" : ""}>{stockDisplay(product)}</span>
                  </td>
                  <td className="p-3 text-right text-slate-600">
                    {product.unit_type === "boxes"
                      ? Number(product.current_stock_boxes).toFixed(2)
                      : product.units_per_box && product.units_per_box > 0
                        ? <>
                            <span className="text-xs text-slate-400">~</span>
                            {(
                              (product.unit_type === "kg" ? product.current_stock_kg : product.current_stock_units)
                              / product.units_per_box
                            ).toFixed(2)}
                          </>
                        : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="p-3 text-right">{formatCurrency(product.weighted_avg_cost)}</td>
                  <td className="p-3 text-right">
                    <div>{formatCurrency(product.selling_price)}</div>
                    <div className="text-xs text-green-600">{margin}% margin</div>
                  </td>
                  <td className="p-3 text-center">
                    {low ? <Badge variant="destructive">Low</Badge> : <Badge variant="success">OK</Badge>}
                  </td>
                  {canEdit && (
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(product)}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-green-600 hover:text-green-700"
                          onClick={() => { setRestockForm(emptyRestock); setRestockDialog({ open: true, product }); }}>
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
          <div className="text-center py-12 text-muted-foreground">No products found</div>
        )}
      </div>

      {/* ── Add / Edit Product Dialog ── */}
      <Dialog open={productDialog} onOpenChange={setProductDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editProduct ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">

            {/* Name */}
            <div>
              <Label>Name *</Label>
              <Input
                value={productForm.name}
                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                placeholder="e.g. Chicken Thighs"
              />
            </div>

            {/* Category + Unit Type */}
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
                <Select
                  value={productForm.unit_type}
                  onValueChange={(v) => setProductForm({ ...productForm, unit_type: v as UnitType, opening_qty: "", opening_boxes: "" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">Weight (kg)</SelectItem>
                    <SelectItem value="units">Units (pieces)</SelectItem>
                    <SelectItem value="boxes">Boxes only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Units per box + Selling price */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>
                  {productForm.unit_type === "kg" ? "kg per Box" : "Units per Box"}
                </Label>
                <Input
                  type="number" min="0" step="any"
                  value={productForm.units_per_box}
                  onChange={(e) => setProductForm({ ...productForm, units_per_box: e.target.value })}
                  placeholder={productForm.unit_type === "kg" ? "e.g. 25" : "e.g. 12"}
                />
              </div>
              <div>
                <Label>Selling Price *</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={productForm.selling_price}
                  onChange={(e) => setProductForm({ ...productForm, selling_price: e.target.value })}
                />
              </div>
            </div>

            {/* Thresholds */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Low Stock Threshold ({primaryLabel(productForm.unit_type)})</Label>
                <Input
                  type="number" min="0" step="any"
                  value={productForm.low_stock_threshold}
                  onChange={(e) => setProductForm({ ...productForm, low_stock_threshold: e.target.value })}
                />
              </div>
              <div>
                <Label>Variance % Threshold</Label>
                <Input
                  type="number" min="0" max="100"
                  value={productForm.variance_threshold_pct}
                  onChange={(e) => setProductForm({ ...productForm, variance_threshold_pct: e.target.value })}
                />
              </div>
            </div>

            {/* WAC Override — only shown when editing */}
            {editProduct && (
              <div className="border rounded-lg p-3 bg-amber-50 border-amber-200 space-y-2">
                <div>
                  <p className="text-sm font-medium text-amber-800">Override Average Cost</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Current: {formatCurrency(editProduct.weighted_avg_cost)} — leave blank to keep unchanged. The next restock will blend from whatever value you set here.
                  </p>
                </div>
                <Input
                  type="number" min="0" step="0.01"
                  value={productForm.override_wac}
                  onChange={(e) => setProductForm({ ...productForm, override_wac: e.target.value })}
                  placeholder="New cost price..."
                  className="bg-white"
                />
              </div>
            )}

            {/* Opening Stock — only shown when creating */}
            {!editProduct && (
              <div className="border rounded-lg p-3 bg-slate-50 space-y-3">
                <p className="text-sm font-medium text-slate-700">Opening Stock <span className="text-slate-400 font-normal">(optional)</span></p>

                <div className={productForm.unit_type === "boxes" ? "" : "grid grid-cols-2 gap-3"}>
                  {/* Primary qty — hidden for "boxes" type since boxes IS the primary */}
                  {productForm.unit_type !== "boxes" && (
                    <div>
                      <Label>
                        {productForm.unit_type === "kg" ? "Weight (kg)" : "Quantity (units)"}
                      </Label>
                      <Input
                        type="number" min="0" step={productForm.unit_type === "kg" ? "0.001" : "1"}
                        value={productForm.opening_qty}
                        onChange={(e) => setProductForm({ ...productForm, opening_qty: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                  )}

                  {/* Boxes */}
                  <div>
                    <Label>Boxes</Label>
                    <Input
                      type="number" min="0" step="0.01"
                      value={productForm.opening_boxes}
                      onChange={(e) => setProductForm({ ...productForm, opening_boxes: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Cost — only required if stock entered */}
                {(parseFloat(productForm.opening_qty) > 0 || parseFloat(productForm.opening_boxes) > 0) && (
                  <div>
                    <Label>
                      Cost Price (per {primaryLabel(productForm.unit_type)}) *
                    </Label>
                    <Input
                      type="number" min="0" step="0.01"
                      value={productForm.opening_cost}
                      onChange={(e) => setProductForm({ ...productForm, opening_cost: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setProductDialog(false); setEditProduct(null); }}>Cancel</Button>
            <Button onClick={handleSaveProduct} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Restock Dialog ── */}
      <Dialog open={bulkRestockDialog} onOpenChange={(o) => { if (!bulkSaving) setBulkRestockDialog(o); }}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-4 pb-3 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <Truck className="h-4 w-4 text-blue-500" />
              Bulk Restock
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable table area */}
          <div className="flex-1 overflow-auto px-6 py-4">
            <table className="w-full text-sm border-separate border-spacing-y-1">
              <thead>
                <tr className="text-left">
                  <th className="pb-2 font-medium text-slate-500 w-8">#</th>
                  <th className="pb-2 font-medium text-slate-500 min-w-[200px]">Product *</th>
                  <th className="pb-2 font-medium text-slate-500 w-32">Qty (primary)</th>
                  <th className="pb-2 font-medium text-slate-500 w-28">Boxes</th>
                  <th className="pb-2 font-medium text-slate-500 w-32">Cost / box *</th>
                  <th className="pb-2 font-medium text-slate-500 w-32 text-right">Total Cost</th>
                  <th className="pb-2 pl-6 font-medium text-slate-500">Supplier</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, idx) => {
                  const selectedProduct = products.find((p) => p.id === row.product_id) ?? null;
                  const upb = selectedProduct?.units_per_box ?? 0;
                  const ut = selectedProduct?.unit_type;
                  const qPrimary = parseFloat(row.quantity_primary) || 0;
                  const qBoxes = parseFloat(row.quantity_boxes) || 0;
                  const costPerBox = parseFloat(row.cost_per_box) || 0;
                  const costPerUnit = upb > 0 && ut !== "boxes" ? costPerBox / upb : costPerBox;
                  const primaryQty = ut === "boxes" ? qBoxes : qPrimary + qBoxes * upb;
                  const rowTotal = primaryQty * costPerUnit;
                  const showBoxHint = !!selectedProduct && upb > 0 && qBoxes > 0 && ut !== "boxes";

                  return (
                    <tr key={row.rowId} className="bg-slate-50">
                      {/* Row number */}
                      <td className="pl-2 py-2 rounded-l-lg text-slate-400 text-center align-top pt-3 text-xs">
                        {idx + 1}
                      </td>

                      {/* Product */}
                      <td className="px-2 py-2 align-top">
                        <Select
                          value={row.product_id}
                          onValueChange={(v) =>
                            setBulkRows(bulkRows.map((r) =>
                              r.rowId === row.rowId
                                ? { ...r, product_id: v, quantity_primary: "", quantity_boxes: "" }
                                : r,
                            ))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select product..." />
                          </SelectTrigger>
                          <SelectContent>
                            {products
                              .filter((p) => p.is_active)
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                  <span className="ml-1 text-slate-400 text-[11px]">({p.unit_type})</span>
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </td>

                      {/* Primary qty */}
                      <td className="px-2 py-2 align-top">
                        {selectedProduct && ut !== "boxes" ? (
                          <Input
                            type="number"
                            min="0"
                            step={ut === "kg" ? "0.001" : "1"}
                            placeholder={ut === "kg" ? "0.000" : "0"}
                            value={row.quantity_primary}
                            onChange={(e) =>
                              setBulkRows(bulkRows.map((r) =>
                                r.rowId === row.rowId ? { ...r, quantity_primary: e.target.value } : r,
                              ))
                            }
                            className="h-8 text-xs"
                          />
                        ) : (
                          <span className="text-slate-300 text-xs block text-center pt-2">—</span>
                        )}
                      </td>

                      {/* Boxes */}
                      <td className="px-2 py-2 align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0"
                          value={row.quantity_boxes}
                          onChange={(e) =>
                            setBulkRows(bulkRows.map((r) =>
                              r.rowId === row.rowId ? { ...r, quantity_boxes: e.target.value } : r,
                            ))
                          }
                          className="h-8 text-xs"
                        />
                        {showBoxHint && (
                          <p className="text-[10px] text-blue-600 mt-0.5">
                            = {(qBoxes * upb).toFixed(ut === "kg" ? 3 : 0)} {ut === "kg" ? "kg" : "units"}
                          </p>
                        )}
                      </td>

                      {/* Cost per box */}
                      <td className="px-2 py-2 align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={row.cost_per_box}
                          onChange={(e) =>
                            setBulkRows(bulkRows.map((r) =>
                              r.rowId === row.rowId ? { ...r, cost_per_box: e.target.value } : r,
                            ))
                          }
                          className="h-8 text-xs"
                        />
                        {selectedProduct && upb > 0 && ut !== "boxes" && costPerBox > 0 && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            = {formatCurrency(costPerUnit)}/{ut === "kg" ? "kg" : "unit"}
                          </p>
                        )}
                      </td>

                      {/* Total cost */}
                      <td className="px-2 py-2 align-top text-right">
                        <span className={`text-sm font-semibold ${rowTotal > 0 ? "text-slate-800" : "text-slate-300"}`}>
                          {rowTotal > 0 ? formatCurrency(rowTotal) : "—"}
                        </span>
                      </td>

                      {/* Supplier */}
                      <td className="pl-6 pr-2 py-2 align-top">
                        <Input
                          placeholder="Optional"
                          value={row.supplier}
                          onChange={(e) =>
                            setBulkRows(bulkRows.map((r) =>
                              r.rowId === row.rowId ? { ...r, supplier: e.target.value } : r,
                            ))
                          }
                          className="h-8 text-xs"
                        />
                      </td>

                      {/* Remove row */}
                      <td className="pr-2 py-2 rounded-r-lg align-top pt-2.5">
                        <button
                          onClick={() => setBulkRows(bulkRows.filter((r) => r.rowId !== row.rowId))}
                          disabled={bulkRows.length === 1}
                          className="text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Add row */}
            <button
              onClick={() => setBulkRows([...bulkRows, emptyBulkRow()])}
              className="mt-3 w-full py-2 rounded-lg border-2 border-dashed border-slate-200 text-sm text-slate-400 hover:border-blue-300 hover:text-blue-500 flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add another product
            </button>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-slate-50 flex-shrink-0">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-slate-500">
                {bulkRows.filter((r) => r.product_id).length} product
                {bulkRows.filter((r) => r.product_id).length !== 1 ? "s" : ""}
              </p>
              <div className="text-right">
                <p className="text-xs text-slate-500">Total restock value</p>
                <p className="text-lg font-bold text-blue-600">
                  {formatCurrency(
                    bulkRows.reduce((sum, row) => {
                      const p = products.find((pr) => pr.id === row.product_id);
                      const upb = p?.units_per_box ?? 0;
                      const ut = p?.unit_type;
                      const qPrimary = parseFloat(row.quantity_primary) || 0;
                      const qBoxes = parseFloat(row.quantity_boxes) || 0;
                      const costPerBox = parseFloat(row.cost_per_box) || 0;
                      const costPerUnit = upb > 0 && ut !== "boxes" ? costPerBox / upb : costPerBox;
                      const qty = ut === "boxes" ? qBoxes : qPrimary + qBoxes * upb;
                      return sum + qty * costPerUnit;
                    }, 0),
                  )}
                </p>
              </div>
            </div>
            <DialogFooter className="sm:justify-between gap-2 mt-3">
              <Button
                variant="outline"
                onClick={() => { if (!bulkSaving) { setBulkRestockDialog(false); } }}
                disabled={bulkSaving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleBulkRestock}
                disabled={bulkSaving || bulkRows.every((r) => !r.product_id)}
                className="gap-2 min-w-[160px]"
              >
                <Truck className="h-4 w-4" />
                {bulkSaving
                  ? "Saving..."
                  : `Save ${bulkRows.filter((r) => r.product_id).length} Restock${bulkRows.filter((r) => r.product_id).length !== 1 ? "s" : ""}`}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Restock Dialog ── */}
      <Dialog open={restockDialog.open} onOpenChange={(open) => setRestockDialog({ ...restockDialog, open })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Stock — {restockProduct?.name}</DialogTitle>
          </DialogHeader>
          {restockProduct && (
            <div className="space-y-3">
              {/* Primary qty + Boxes side-by-side, or single box for "boxes" type */}
              <div className={restockProduct.unit_type === "boxes" ? "" : "grid grid-cols-2 gap-3"}>
                {restockProduct.unit_type !== "boxes" && (
                  <div>
                    <Label>
                      {restockProduct.unit_type === "kg" ? "Weight (kg)" : "Quantity (units)"}
                    </Label>
                    <Input
                      type="number" min="0"
                      step={restockProduct.unit_type === "kg" ? "0.001" : "1"}
                      value={restockForm.quantity_primary}
                      onChange={(e) => setRestockForm({ ...restockForm, quantity_primary: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                )}
                <div>
                  <Label>Boxes</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={restockForm.quantity_boxes}
                    onChange={(e) => setRestockForm({ ...restockForm, quantity_boxes: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Show conversion hint */}
              {restockProduct.units_per_box && (parseFloat(restockForm.quantity_boxes) > 0) && (
                <p className="text-xs text-slate-500">
                  {parseFloat(restockForm.quantity_boxes)} box(es) ×{" "}
                  {restockProduct.units_per_box}{" "}
                  {restockProduct.unit_type === "kg" ? "kg" : "units"}/box ={" "}
                  {(parseFloat(restockForm.quantity_boxes) * restockProduct.units_per_box).toFixed(3)}{" "}
                  {restockProduct.unit_type === "kg" ? "kg" : "units"} added to stock
                </p>
              )}

              <div>
                <Label>Cost Price (per {primaryLabel(restockProduct.unit_type)}) *</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={restockForm.cost_price_per_unit}
                  onChange={(e) => setRestockForm({ ...restockForm, cost_price_per_unit: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Supplier</Label>
                <Input
                  value={restockForm.supplier}
                  onChange={(e) => setRestockForm({ ...restockForm, supplier: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={restockForm.notes}
                  onChange={(e) => setRestockForm({ ...restockForm, notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestockDialog({ open: false, product: null })}>Cancel</Button>
            <Button onClick={handleRestock} disabled={saving}>{saving ? "Saving..." : "Add Stock"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
