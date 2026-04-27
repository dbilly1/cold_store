"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2 } from "lucide-react";

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
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <Tabs defaultValue="system">
        <TabsList>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        {/* ── System Config ── */}
        <TabsContent value="system">
          <Card>
            <CardContent className="pt-6 space-y-4 max-w-sm">
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
        </TabsContent>

        {/* ── Categories ── */}
        <TabsContent value="categories">
          <Card>
            <CardContent className="pt-6 max-w-sm">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-slate-700">Product Categories</p>
                <Button size="sm" onClick={() => setCatDialog(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
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
        </TabsContent>

      </Tabs>

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
