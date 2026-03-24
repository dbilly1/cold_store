"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Settings, Tag } from "lucide-react";

interface Config { id: string; key: string; value: string; description: string | null; }
interface Category { id: string; name: string; description: string | null; }

const CONFIG_LABELS: Record<string, string> = {
  global_variance_threshold_pct: "Global Variance Threshold (%)",
  low_stock_alert_enabled: "Low Stock Alerts",
  reconciliation_tolerance: "Cash Reconciliation Tolerance (GHS)",
  fraud_adjustment_count_threshold: "Fraud Alert Threshold (adjustments/day)",
  store_name: "Store Name",
  currency_symbol: "Currency Symbol",
};

export function SettingsClient({ config: initial, categories: initialCats }: { config: Config[]; categories: Category[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [config, setConfig] = useState<Config[]>(initial);
  const [categories, setCategories] = useState<Category[]>(initialCats);
  const [saving, setSaving] = useState<string | null>(null);
  const [catDialog, setCatDialog] = useState(false);
  const [newCat, setNewCat] = useState({ name: "", description: "" });

  async function saveConfig(key: string, value: string) {
    setSaving(key);
    const supabase = createClient();
    const { error } = await supabase
      .from("system_config")
      .update({ value, updated_by: profile!.id, updated_at: new Date().toISOString() })
      .eq("key", key);

    if (error) { toast({ title: "Error saving", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Setting saved" }); setConfig(config.map(c => c.key === key ? { ...c, value } : c)); }
    setSaving(null);
  }

  async function addCategory() {
    if (!newCat.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: newCat.name.trim(), description: newCat.description || null })
      .select()
      .single();

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { setCategories([...categories, data as Category]); setCatDialog(false); setNewCat({ name: "", description: "" }); toast({ title: "Category added" }); }
  }

  async function deleteCategory(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) { toast({ title: "Cannot delete — category in use", variant: "destructive" }); }
    else { setCategories(categories.filter(c => c.id !== id)); toast({ title: "Category deleted" }); }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">

        {/* System Config */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4 text-blue-500" />
              System Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {config.map((c) => (
              <ConfigRow
                key={c.key}
                config={c}
                label={CONFIG_LABELS[c.key] ?? c.key}
                saving={saving === c.key}
                onSave={(value) => saveConfig(c.key, value)}
              />
            ))}
          </CardContent>
        </Card>

        {/* Categories */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="h-4 w-4 text-purple-500" />
              Product Categories
            </CardTitle>
            <Button size="sm" onClick={() => setCatDialog(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between p-2 rounded-lg border hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium">{cat.name}</p>
                    {cat.description && <p className="text-xs text-muted-foreground">{cat.description}</p>}
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-red-500 hover:text-red-700" onClick={() => deleteCategory(cat.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No categories</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Category</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} /></div>
            <div><Label>Description</Label><Input value={newCat.description} onChange={(e) => setNewCat({ ...newCat, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog(false)}>Cancel</Button>
            <Button onClick={addCategory}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfigRow({ config, label, saving, onSave }: { config: Config; label: string; saving: boolean; onSave: (v: string) => void }) {
  const [value, setValue] = useState(config.value);
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {config.description && <p className="text-xs text-muted-foreground">{config.description}</p>}
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 text-sm" />
        <Button size="sm" className="h-8 px-3" disabled={saving || value === config.value} onClick={() => onSave(value)}>
          {saving ? "..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
