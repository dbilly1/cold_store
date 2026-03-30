"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils";
import { Plus, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import type { AdjustmentReason } from "@/types/database";

interface Product {
  id: string; name: string; unit_type: string;
  current_stock_kg: number; current_stock_units: number; current_stock_boxes: number;
  variance_threshold_pct: number;
}

interface Adjustment {
  id: string; reason: string; reason_detail: string;
  quantity_kg_delta: number; quantity_units_delta: number; quantity_boxes_delta: number;
  stock_before_kg: number; stock_before_units: number;
  approval_status: string; requires_approval: boolean; created_at: string;
  product: { name: string; unit_type: string } | null;
  adjusted_by_profile: { full_name: string } | null;
  approved_by_profile: { full_name: string } | null;
}

const REASONS: { value: AdjustmentReason; label: string }[] = [
  { value: "melt_loss", label: "Melt Loss" },
  { value: "spoilage", label: "Spoilage" },
  { value: "handling_loss", label: "Handling Loss" },
  { value: "measurement_variance", label: "Measurement Variance" },
  { value: "other", label: "Other" },
];

export function AdjustmentsClient({
  products, adjustments: initial, userRole,
}: { products: Product[]; adjustments: Adjustment[]; userRole: string }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [adjustments, setAdjustments] = useState<Adjustment[]>(initial);
  const [dialog, setDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    product_id: "", reason: "melt_loss" as AdjustmentReason,
    reason_detail: "", quantity_kg_delta: "0", quantity_units_delta: "0", quantity_boxes_delta: "0",
  });

  const product = products.find((p) => p.id === form.product_id);

  async function handleSubmit() {
    if (!product) { toast({ title: "Select a product", variant: "destructive" }); return; }
    if (!form.reason_detail.trim()) { toast({ title: "Reason detail required", variant: "destructive" }); return; }

    setSaving(true);
    const supabase = createClient();
    const qKg = parseFloat(form.quantity_kg_delta) || 0;
    const qUnits = parseFloat(form.quantity_units_delta) || 0;
    const qBoxes = parseFloat(form.quantity_boxes_delta) || 0;

    // Determine if within threshold (auto-approve) or needs approval
    const primaryDelta = Math.abs(product.unit_type === "kg" ? qKg : qUnits);
    const primaryStock = product.unit_type === "kg" ? product.current_stock_kg : product.current_stock_units;
    const variancePct = primaryStock > 0 ? (primaryDelta / primaryStock) * 100 : 100;
    const requiresApproval = variancePct > product.variance_threshold_pct;

    const { data, error } = await supabase
      .from("stock_adjustments")
      .insert({
        product_id: product.id,
        adjusted_by: profile!.id,
        reason: form.reason,
        reason_detail: form.reason_detail,
        quantity_kg_delta: qKg,
        quantity_units_delta: qUnits,
        quantity_boxes_delta: qBoxes,
        stock_before_kg: product.current_stock_kg,
        stock_before_units: product.current_stock_units,
        stock_before_boxes: product.current_stock_boxes,
        requires_approval: requiresApproval,
        approval_status: requiresApproval ? "pending" as const : "approved" as const,
      })
      .select(`
        id, reason, reason_detail, quantity_kg_delta, quantity_units_delta, quantity_boxes_delta,
        stock_before_kg, stock_before_units, approval_status, requires_approval, created_at,
        product:products(name, unit_type),
        adjusted_by_profile:profiles!stock_adjustments_adjusted_by_fkey(full_name),
        approved_by_profile:profiles!stock_adjustments_approved_by_fkey(full_name)
      `)
      .single();

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      setAdjustments([data as unknown as Adjustment, ...adjustments]);
      toast({
        title: requiresApproval ? "Adjustment submitted — awaiting approval" : "Adjustment applied",
        variant: requiresApproval ? "default" : "success" as never,
      });
      if (requiresApproval) {
        await supabase.from("alerts").insert({
          alert_type: "excessive_adjustments", severity: "medium",
          title: "Stock Adjustment Requires Approval",
          message: `Adjustment of ${product.name} exceeds ${product.variance_threshold_pct}% variance threshold.`,
          related_entity_type: "stock_adjustments", related_entity_id: data.id,
        });
      }
      await supabase.from("audit_logs").insert({
        user_id: profile!.id, action: "CREATE_ADJUSTMENT", entity_type: "stock_adjustments",
        entity_id: data.id, new_value: { product: product.name, qKg, qUnits, reason: form.reason },
      });
    }

    setDialog(false);
    setForm({ product_id: "", reason: "melt_loss", reason_detail: "", quantity_kg_delta: "0", quantity_units_delta: "0", quantity_boxes_delta: "0" });
    setSaving(false);
  }

  async function handleApprove(id: string, approved: boolean) {
    const supabase = createClient();
    const { error } = await supabase
      .from("stock_adjustments")
      .update({ approval_status: approved ? "approved" : "rejected", approved_by: profile!.id, approved_at: new Date().toISOString() })
      .eq("id", id);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setAdjustments(adjustments.map((a) => a.id === id ? { ...a, approval_status: approved ? "approved" : "rejected" } : a));
    toast({ title: approved ? "Adjustment approved" : "Adjustment rejected" });
  }

  const statusBadge = (status: string) => {
    if (status === "approved") return <Badge variant="success">Approved</Badge>;
    if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    return <Badge variant="warning">Pending</Badge>;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="font-semibold text-slate-700">Recent Adjustments</h2>
        <Button onClick={() => setDialog(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Adjustment
        </Button>
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3 font-medium text-slate-600">Product</th>
              <th className="text-left p-3 font-medium text-slate-600">Reason</th>
              <th className="text-left p-3 font-medium text-slate-600">Detail</th>
              <th className="text-right p-3 font-medium text-slate-600">Delta (kg/units)</th>
              <th className="text-center p-3 font-medium text-slate-600">Status</th>
              <th className="text-left p-3 font-medium text-slate-600">By</th>
              <th className="text-left p-3 font-medium text-slate-600">Date</th>
              {(userRole === "admin" || userRole === "supervisor") && (
                <th className="text-center p-3 font-medium text-slate-600">Action</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {adjustments.map((adj) => {
              const delta = adj.quantity_kg_delta !== 0 ? adj.quantity_kg_delta : adj.quantity_units_delta;
              const p = adj.product as { name: string; unit_type: string } | null;
              return (
                <tr key={adj.id} className="hover:bg-slate-50">
                  <td className="p-3 font-medium">{p?.name}</td>
                  <td className="p-3">
                    <span className="capitalize">{adj.reason.replace(/_/g, " ")}</span>
                  </td>
                  <td className="p-3 text-slate-600 max-w-xs truncate">{adj.reason_detail}</td>
                  <td className={`p-3 text-right font-semibold ${delta < 0 ? "text-red-600" : "text-green-600"}`}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(3)} {p?.unit_type}
                  </td>
                  <td className="p-3 text-center">{statusBadge(adj.approval_status)}</td>
                  <td className="p-3 text-slate-500 text-xs">
                    {(adj.adjusted_by_profile as { full_name: string } | null)?.full_name}
                  </td>
                  <td className="p-3 text-xs text-slate-500">{formatDateTime(adj.created_at)}</td>
                  {(userRole === "admin" || userRole === "supervisor") && (
                    <td className="p-3">
                      {adj.approval_status === "pending" && (
                        <div className="flex gap-1 justify-center">
                          <Button size="sm" variant="ghost" className="text-green-600 h-7 px-2" onClick={() => handleApprove(adj.id, true)}>
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600 h-7 px-2" onClick={() => handleApprove(adj.id, false)}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {adjustments.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">No adjustments yet</div>
        )}
      </div>

      {/* Dialog */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              New Stock Adjustment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Product *</Label>
              <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select product..." /></SelectTrigger>
                <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {product && (
              <p className="text-xs text-muted-foreground bg-slate-50 p-2 rounded">
                Current: {product.unit_type === "kg" ? `${product.current_stock_kg} kg` : `${product.current_stock_units} units`}
                {" "}· Threshold: {product.variance_threshold_pct}%
              </p>
            )}
            <div>
              <Label>Reason *</Label>
              <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v as AdjustmentReason })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Detail / Notes *</Label>
              <Input value={form.reason_detail} onChange={(e) => setForm({ ...form, reason_detail: e.target.value })} placeholder="Describe the adjustment..." />
            </div>
            <p className="text-xs text-muted-foreground">Enter negative values to reduce stock, positive to increase.</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label>kg delta</Label>
                <Input type="number" step="0.001" value={form.quantity_kg_delta} onChange={(e) => setForm({ ...form, quantity_kg_delta: e.target.value })} />
              </div>
              <div>
                <Label>units delta</Label>
                <Input type="number" value={form.quantity_units_delta} onChange={(e) => setForm({ ...form, quantity_units_delta: e.target.value })} />
              </div>
              <div>
                <Label>boxes delta</Label>
                <Input type="number" value={form.quantity_boxes_delta} onChange={(e) => setForm({ ...form, quantity_boxes_delta: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Submit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
