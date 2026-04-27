"use client";

import { useState, useMemo } from "react";
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
import { formatCurrency, formatDate } from "@/lib/utils";
import { Plus, Receipt, Banknote, Pencil } from "lucide-react";
import { TablePagination } from "@/components/ui/table-pagination";
import { format } from "date-fns";
import type { ExpenseCategory } from "@/types/database";

const CATEGORIES: { value: ExpenseCategory; label: string; color: string }[] = [
  { value: "electricity", label: "Electricity", color: "bg-yellow-100 text-yellow-800" },
  { value: "transport", label: "Transport", color: "bg-blue-100 text-blue-800" },
  { value: "wages", label: "Wages", color: "bg-purple-100 text-purple-800" },
  { value: "rent", label: "Rent", color: "bg-red-100 text-red-800" },
  { value: "maintenance", label: "Maintenance", color: "bg-orange-100 text-orange-800" },
  { value: "packaging", label: "Packaging", color: "bg-teal-100 text-teal-800" },
  { value: "cleaning", label: "Cleaning", color: "bg-green-100 text-green-800" },
  { value: "miscellaneous", label: "Miscellaneous", color: "bg-slate-100 text-slate-800" },
];

interface Expense {
  id: string;
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  paid_from_till: boolean;
  batch_id: string | null;
  created_at: string;
  recorded_by_profile: { full_name: string } | null;
}

type EditForm = {
  expense_date: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  paid_from_till: boolean;
};

export function ExpensesClient({ expenses: initial }: { expenses: Expense[] }) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [expenses, setExpenses] = useState<Expense[]>(initial);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [dialog, setDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [editId, setEditId] = useState("");
  const [editForm, setEditForm] = useState<EditForm>({
    expense_date: "",
    category: "electricity" as ExpenseCategory,
    description: "",
    amount: "",
    paid_from_till: false,
  });
  const [form, setForm] = useState({
    expense_date: format(new Date(), "yyyy-MM-dd"),
    category: "electricity" as ExpenseCategory,
    description: "",
    amount: "",
    paid_from_till: false,
  });

  const pagedExpenses = useMemo(
    () => expenses.slice(page * pageSize, (page + 1) * pageSize),
    [expenses, page, pageSize],
  );

  const totalThisMonth = expenses.reduce((s, e) => s + e.amount, 0);
  const byCategory = CATEGORIES.map((cat) => ({
    ...cat,
    total: expenses.filter(e => e.category === cat.value).reduce((s, e) => s + e.amount, 0),
  })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  async function handleSubmit() {
    if (!form.description.trim()) { toast({ title: "Description required", variant: "destructive" }); return; }
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { toast({ title: "Valid amount required", variant: "destructive" }); return; }

    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("expenses")
      .insert({
        expense_date: form.expense_date,
        category: form.category,
        description: form.description.trim(),
        amount,
        paid_from_till: form.paid_from_till,
        recorded_by: profile!.id,
      })
      .select(`*, recorded_by_profile:profiles!expenses_recorded_by_fkey(full_name)`)
      .single();

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      setExpenses([data as Expense, ...expenses]);
      const { error: auditErr } = await supabase.from("audit_logs").insert({
        user_id: profile!.id, action: "CREATE_EXPENSE", entity_type: "expenses", entity_id: data.id,
        new_value: { category: form.category, amount, description: form.description, paid_from_till: form.paid_from_till },
      });
      if (auditErr) console.warn("Audit log insert failed:", auditErr.message);
      toast({ title: "Expense recorded" });
      setDialog(false);
      setForm({ expense_date: format(new Date(), "yyyy-MM-dd"), category: "electricity", description: "", amount: "", paid_from_till: false });
    }
    setSaving(false);
  }

  function openEdit(expense: Expense) {
    setEditId(expense.id);
    setEditForm({
      expense_date: expense.expense_date,
      category: expense.category,
      description: expense.description,
      amount: expense.amount.toString(),
      paid_from_till: expense.paid_from_till,
    });
    setEditDialog(true);
  }

  async function handleUpdate() {
    if (!editForm.description.trim()) { toast({ title: "Description required", variant: "destructive" }); return; }
    const amount = parseFloat(editForm.amount);
    if (!amount || amount <= 0) { toast({ title: "Valid amount required", variant: "destructive" }); return; }

    setSaving(true);
    const supabase = createClient();
    const prev = expenses.find((e) => e.id === editId);
    const { error } = await supabase
      .from("expenses")
      .update({
        expense_date: editForm.expense_date,
        category: editForm.category,
        description: editForm.description.trim(),
        amount,
        paid_from_till: editForm.paid_from_till,
      })
      .eq("id", editId);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      setExpenses(expenses.map((e) =>
        e.id === editId ? { ...e, ...editForm, amount } : e
      ));
      const { error: auditErr2 } = await supabase.from("audit_logs").insert({
        user_id: profile!.id, action: "UPDATE_EXPENSE", entity_type: "expenses", entity_id: editId,
        previous_value: prev ? { category: prev.category, amount: prev.amount, description: prev.description } : null,
        new_value: { category: editForm.category, amount, description: editForm.description, paid_from_till: editForm.paid_from_till },
      });
      if (auditErr2) console.warn("Audit log insert failed:", auditErr2.message);
      toast({ title: "Expense updated" });
      setEditDialog(false);
    }
    setSaving(false);
  }

  const getCategoryStyle = (cat: ExpenseCategory) =>
    CATEGORIES.find(c => c.value === cat)?.color ?? "bg-slate-100 text-slate-800";

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Summary sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Receipt className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-medium text-muted-foreground">Last 30 Days</p>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(totalThisMonth)}</p>
            </CardContent>
          </Card>

          {byCategory.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-medium mb-3">By Category</p>
                <div className="space-y-2">
                  {byCategory.map((cat) => (
                    <div key={cat.value} className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.color}`}>
                        {cat.label}
                      </span>
                      <span className="text-sm font-semibold">{formatCurrency(cat.total)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Button onClick={() => setDialog(true)} className="w-full">
            <Plus className="h-4 w-4 mr-1" /> Add Expense
          </Button>
        </div>

        {/* Expense list */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-3 font-medium text-slate-600">Date</th>
                  <th className="text-left p-3 font-medium text-slate-600">Category</th>
                  <th className="text-left p-3 font-medium text-slate-600">Description</th>
                  <th className="text-right p-3 font-medium text-slate-600">Amount</th>
                  <th className="text-center p-3 font-medium text-slate-600">Till</th>
                  <th className="text-left p-3 font-medium text-slate-600">By</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {pagedExpenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-slate-50">
                    <td className="p-3">{formatDate(expense.expense_date)}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getCategoryStyle(expense.category)}`}>
                        {CATEGORIES.find(c => c.value === expense.category)?.label}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{expense.description}</td>
                    <td className="p-3 text-right font-semibold">{formatCurrency(expense.amount)}</td>
                    <td className="p-3 text-center">
                      {expense.paid_from_till && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                          <Banknote className="h-3 w-3" /> Till
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-slate-500">
                      {(expense.recorded_by_profile as { full_name: string } | null)?.full_name}
                    </td>
                    <td className="p-3">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700"
                        onClick={() => openEdit(expense)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expenses.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">No expenses recorded</div>
            )}
            {expenses.length > 0 && (
              <TablePagination
                total={expenses.length}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={editForm.expense_date} onChange={(e) => setEditForm({ ...editForm, expense_date: e.target.value })} />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={editForm.category} onValueChange={(v) => setEditForm({ ...editForm, category: v as ExpenseCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description *</Label>
              <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </div>
            <div>
              <Label>Amount (GHS) *</Label>
              <Input type="number" min="0" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={editForm.paid_from_till}
                onChange={(e) => setEditForm({ ...editForm, paid_from_till: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm">Paid from daily cash (till)</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add dialog */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            </div>
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as ExpenseCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description *</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Electricity bill for March" />
            </div>
            <div>
              <Label>Amount (GHS) *</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.paid_from_till}
                onChange={(e) => setForm({ ...form, paid_from_till: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm">Paid from daily cash (till)</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
