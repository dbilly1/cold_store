"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Plus, Phone, User, Wallet, Pencil, Trash2 } from "lucide-react";

interface Customer {
  id: string;
  full_name: string;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

interface CreditSaleItem {
  id: string;
  line_total: number;
  product: { name: string; unit_type: string } | null;
}

interface CreditSale {
  id: string;
  sale_date: string;
  total_amount: number;
  customer_id: string;
  recorded_by_profile: { full_name: string } | null;
  items: CreditSaleItem[];
}

interface CreditPayment {
  id: string;
  customer_id: string;
  amount: number;
  payment_method: string;
  payment_date: string;
  notes: string | null;
  recorded_by_profile: { full_name: string } | null;
}

export function CreditClient({
  customers: initialCustomers,
  creditSales,
  creditPayments: initialPayments,
}: {
  customers: Customer[];
  creditSales: CreditSale[];
  creditPayments: CreditPayment[];
}) {
  const { toast } = useToast();
  const { profile } = useProfile();
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [payments, setPayments] = useState<CreditPayment[]>(initialPayments);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialCustomers[0]?.id ?? null,
  );

  // Payment dialog
  const [paymentDialog, setPaymentDialog] = useState({
    open: false,
    customerId: "",
    amount: "",
    method: "cash" as "cash" | "mobile_money",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [paymentSaving, setPaymentSaving] = useState(false);

  // New customer dialog
  const [newCustomerDialog, setNewCustomerDialog] = useState({
    open: false,
    name: "",
    phone: "",
    notes: "",
  });
  const [customerSaving, setCustomerSaving] = useState(false);

  // Edit customer dialog
  const [editCustomerDialog, setEditCustomerDialog] = useState({
    open: false,
    id: "",
    name: "",
    phone: "",
    notes: "",
  });
  const [editCustomerSaving, setEditCustomerSaving] = useState(false);

  // Delete customer dialog
  const [deleteCustomerDialog, setDeleteCustomerDialog] = useState({
    open: false,
    id: "",
    name: "",
  });
  const [deleteCustomerSaving, setDeleteCustomerSaving] = useState(false);

  // Per-customer aggregates
  function getBalance(customerId: string) {
    const totalCredit = creditSales
      .filter((s) => s.customer_id === customerId)
      .reduce((s, x) => s + x.total_amount, 0);
    const totalPaid = payments
      .filter((p) => p.customer_id === customerId)
      .reduce((s, x) => s + x.amount, 0);
    return { totalCredit, totalPaid, outstanding: totalCredit - totalPaid };
  }

  const sortedCustomers = [...customers].sort((a, b) => {
    const balA = getBalance(a.id).outstanding;
    const balB = getBalance(b.id).outstanding;
    if (balA !== balB) return balB - balA;
    return a.full_name.localeCompare(b.full_name);
  });

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null;
  const selectedBalance = selectedCustomerId ? getBalance(selectedCustomerId) : null;
  const selectedSales = creditSales.filter((s) => s.customer_id === selectedCustomerId);
  const selectedPayments = payments.filter((p) => p.customer_id === selectedCustomerId);

  async function handleRecordPayment() {
    const amt = parseFloat(paymentDialog.amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setPaymentSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("credit_payments")
      .insert({
        customer_id: paymentDialog.customerId,
        amount: amt,
        payment_method: paymentDialog.method,
        payment_date: paymentDialog.date,
        recorded_by: profile!.id,
        notes: paymentDialog.notes || null,
      })
      .select("id, customer_id, amount, payment_method, payment_date, notes, created_at")
      .single();

    if (error || !data) {
      toast({
        title: "Failed to record payment",
        description: error?.message,
        variant: "destructive",
      });
      setPaymentSaving(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "RECORD_CREDIT_PAYMENT",
      entity_type: "credit_payments",
      entity_id: (data as { id: string }).id,
      new_value: { customer_id: paymentDialog.customerId, amount: amt },
    });

    setPayments((prev) => [{ ...(data as CreditPayment), recorded_by_profile: null }, ...prev]);
    toast({ title: "Payment recorded" });
    setPaymentDialog((p) => ({ ...p, open: false, amount: "", notes: "" }));
    setPaymentSaving(false);
  }

  async function handleAddCustomer() {
    if (!newCustomerDialog.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setCustomerSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("customers")
      .insert({
        full_name: newCustomerDialog.name.trim(),
        phone: newCustomerDialog.phone.trim() || null,
        notes: newCustomerDialog.notes.trim() || null,
        created_by: profile!.id,
      })
      .select("id, full_name, phone, notes, created_at")
      .single();

    if (error || !data) {
      toast({
        title: "Failed to add customer",
        description: error?.message,
        variant: "destructive",
      });
      setCustomerSaving(false);
      return;
    }

    const newCust = data as Customer;
    setCustomers((prev) =>
      [...prev, newCust].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    );
    setSelectedCustomerId(newCust.id);
    setNewCustomerDialog({ open: false, name: "", phone: "", notes: "" });
    toast({ title: "Customer added" });
    setCustomerSaving(false);
  }

  async function handleEditCustomer() {
    if (!editCustomerDialog.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setEditCustomerSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("customers")
      .update({
        full_name: editCustomerDialog.name.trim(),
        phone: editCustomerDialog.phone.trim() || null,
        notes: editCustomerDialog.notes.trim() || null,
      })
      .eq("id", editCustomerDialog.id);

    if (error) {
      toast({ title: "Failed to update customer", description: error.message, variant: "destructive" });
      setEditCustomerSaving(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "UPDATE_CUSTOMER",
      entity_type: "customers",
      entity_id: editCustomerDialog.id,
      new_value: { full_name: editCustomerDialog.name.trim(), phone: editCustomerDialog.phone.trim() || null },
    });

    setCustomers((prev) =>
      prev
        .map((c) =>
          c.id === editCustomerDialog.id
            ? { ...c, full_name: editCustomerDialog.name.trim(), phone: editCustomerDialog.phone.trim() || null, notes: editCustomerDialog.notes.trim() || null }
            : c,
        )
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    );
    toast({ title: "Customer updated" });
    setEditCustomerDialog((p) => ({ ...p, open: false }));
    setEditCustomerSaving(false);
  }

  async function handleDeleteCustomer() {
    const { totalCredit } = getBalance(deleteCustomerDialog.id);
    if (totalCredit > 0) {
      toast({
        title: "Cannot delete customer",
        description: "This customer has credit sales on record. Clear their history first.",
        variant: "destructive",
      });
      setDeleteCustomerDialog((p) => ({ ...p, open: false }));
      return;
    }
    setDeleteCustomerSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", deleteCustomerDialog.id);

    if (error) {
      toast({ title: "Failed to delete customer", description: error.message, variant: "destructive" });
      setDeleteCustomerSaving(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "DELETE_CUSTOMER",
      entity_type: "customers",
      entity_id: deleteCustomerDialog.id,
      new_value: { full_name: deleteCustomerDialog.name },
    });

    setCustomers((prev) => prev.filter((c) => c.id !== deleteCustomerDialog.id));
    if (selectedCustomerId === deleteCustomerDialog.id) setSelectedCustomerId(null);
    toast({ title: "Customer deleted" });
    setDeleteCustomerDialog((p) => ({ ...p, open: false }));
    setDeleteCustomerSaving(false);
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left panel: customer list ── */}
      <div className="w-72 border-r bg-white flex flex-col overflow-hidden flex-shrink-0">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Customers</h2>
          <Button
            size="sm"
            onClick={() =>
              setNewCustomerDialog({ open: true, name: "", phone: "", notes: "" })
            }
          >
            <Plus className="h-4 w-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sortedCustomers.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">No customers yet</p>
          )}
          {sortedCustomers.map((customer) => {
            const { outstanding } = getBalance(customer.id);
            const isSelected = selectedCustomerId === customer.id;
            return (
              <button
                key={customer.id}
                onClick={() => setSelectedCustomerId(customer.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-800 text-sm">{customer.full_name}</p>
                  {outstanding > 0.005 ? (
                    <Badge
                      variant="destructive"
                      className="text-xs"
                    >
                      {formatCurrency(outstanding)}
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-green-100 text-green-700"
                    >
                      Settled
                    </Badge>
                  )}
                </div>
                {customer.phone && (
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {customer.phone}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right panel: customer ledger ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedCustomer ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <User className="h-12 w-12 mb-3" />
            <p className="text-lg font-medium">Select a customer</p>
            <p className="text-sm">View their credit history and record payments</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            {/* Customer header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  {selectedCustomer.full_name}
                </h2>
                {selectedCustomer.phone && (
                  <p className="text-slate-500 flex items-center gap-1 mt-0.5 text-sm">
                    <Phone className="h-4 w-4" />
                    {selectedCustomer.phone}
                  </p>
                )}
                {selectedCustomer.notes && (
                  <p className="text-slate-400 text-xs mt-1">{selectedCustomer.notes}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Edit customer"
                  onClick={() =>
                    setEditCustomerDialog({
                      open: true,
                      id: selectedCustomer.id,
                      name: selectedCustomer.full_name,
                      phone: selectedCustomer.phone ?? "",
                      notes: selectedCustomer.notes ?? "",
                    })
                  }
                >
                  <Pencil className="h-4 w-4 text-slate-500" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete customer"
                  onClick={() =>
                    setDeleteCustomerDialog({
                      open: true,
                      id: selectedCustomer.id,
                      name: selectedCustomer.full_name,
                    })
                  }
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
                <Button
                  onClick={() =>
                    setPaymentDialog({
                      open: true,
                      customerId: selectedCustomer.id,
                      amount: "",
                      method: "cash",
                      date: new Date().toISOString().split("T")[0],
                      notes: "",
                    })
                  }
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Record Payment
                </Button>
              </div>
            </div>

            {/* Balance summary cards */}
            {selectedBalance && (
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500 mb-1">Total Credit Taken</p>
                    <p className="text-lg font-bold text-slate-800">
                      {formatCurrency(selectedBalance.totalCredit)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500 mb-1">Total Paid Back</p>
                    <p className="text-lg font-bold text-green-600">
                      {formatCurrency(selectedBalance.totalPaid)}
                    </p>
                  </CardContent>
                </Card>
                <Card
                  className={
                    selectedBalance.outstanding > 0.005
                      ? "border-red-200 bg-red-50"
                      : "border-green-200 bg-green-50"
                  }
                >
                  <CardContent className="p-4">
                    <p className="text-xs text-slate-500 mb-1">Outstanding</p>
                    <p
                      className={`text-lg font-bold ${
                        selectedBalance.outstanding > 0.005
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {formatCurrency(selectedBalance.outstanding)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Credit Sales */}
            <div>
              <h3 className="font-semibold text-slate-700 mb-3">Credit Sales</h3>
              {selectedSales.length === 0 ? (
                <p className="text-sm text-slate-400">No credit sales recorded</p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left p-3 font-medium text-slate-600">Date</th>
                        <th className="text-left p-3 font-medium text-slate-600">Items</th>
                        <th className="text-right p-3 font-medium text-slate-600">Amount</th>
                        <th className="text-left p-3 font-medium text-slate-600 hidden sm:table-cell">
                          Recorded by
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedSales.map((sale) => (
                        <tr key={sale.id} className="hover:bg-slate-50">
                          <td className="p-3 text-slate-600 whitespace-nowrap">
                            {formatDate(sale.sale_date)}
                          </td>
                          <td className="p-3 text-slate-800">
                            {(sale.items ?? [])
                              .map(
                                (i) =>
                                  (i.product as { name: string; unit_type: string } | null)
                                    ?.name,
                              )
                              .filter(Boolean)
                              .join(", ") || "—"}
                          </td>
                          <td className="p-3 text-right font-medium text-slate-800 whitespace-nowrap">
                            {formatCurrency(sale.total_amount)}
                          </td>
                          <td className="p-3 text-slate-500 text-xs hidden sm:table-cell">
                            {(
                              sale.recorded_by_profile as { full_name: string } | null
                            )?.full_name ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Payments Received */}
            <div>
              <h3 className="font-semibold text-slate-700 mb-3">Payments Received</h3>
              {selectedPayments.length === 0 ? (
                <p className="text-sm text-slate-400">No payments recorded yet</p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left p-3 font-medium text-slate-600">Date</th>
                        <th className="text-left p-3 font-medium text-slate-600">Method</th>
                        <th className="text-right p-3 font-medium text-slate-600">Amount</th>
                        <th className="text-left p-3 font-medium text-slate-600">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedPayments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50">
                          <td className="p-3 text-slate-600 whitespace-nowrap">
                            {formatDate(payment.payment_date)}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant="secondary"
                              className={
                                payment.payment_method === "cash"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-blue-100 text-blue-700"
                              }
                            >
                              {payment.payment_method === "cash" ? "Cash" : "Mobile"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right font-medium text-green-600 whitespace-nowrap">
                            +{formatCurrency(payment.amount)}
                          </td>
                          <td className="p-3 text-slate-500 text-xs">
                            {payment.notes ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Record Payment Dialog ── */}
      <Dialog
        open={paymentDialog.open}
        onOpenChange={(o) => setPaymentDialog((p) => ({ ...p, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Record Payment —{" "}
              {customers.find((c) => c.id === paymentDialog.customerId)?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Amount (GHS)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={paymentDialog.amount}
                onChange={(e) => setPaymentDialog((p) => ({ ...p, amount: e.target.value }))}
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select
                value={paymentDialog.method}
                onValueChange={(v) =>
                  setPaymentDialog((p) => ({
                    ...p,
                    method: v as "cash" | "mobile_money",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={paymentDialog.date}
                onChange={(e) => setPaymentDialog((p) => ({ ...p, date: e.target.value }))}
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={paymentDialog.notes}
                onChange={(e) => setPaymentDialog((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Any notes..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPaymentDialog((p) => ({ ...p, open: false }))}
            >
              Cancel
            </Button>
            <Button onClick={handleRecordPayment} disabled={paymentSaving}>
              {paymentSaving ? "Saving..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Customer Dialog ── */}
      <Dialog
        open={editCustomerDialog.open}
        onOpenChange={(o) => setEditCustomerDialog((p) => ({ ...p, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Full Name *</Label>
              <Input
                value={editCustomerDialog.name}
                onChange={(e) => setEditCustomerDialog((p) => ({ ...p, name: e.target.value }))}
                placeholder="Customer name"
                autoFocus
              />
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input
                value={editCustomerDialog.phone}
                onChange={(e) => setEditCustomerDialog((p) => ({ ...p, phone: e.target.value }))}
                placeholder="0XX XXX XXXX"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={editCustomerDialog.notes}
                onChange={(e) => setEditCustomerDialog((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Any additional info"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCustomerDialog((p) => ({ ...p, open: false }))}>
              Cancel
            </Button>
            <Button onClick={handleEditCustomer} disabled={editCustomerSaving}>
              {editCustomerSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Customer Dialog ── */}
      <Dialog
        open={deleteCustomerDialog.open}
        onOpenChange={(o) => setDeleteCustomerDialog((p) => ({ ...p, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-slate-700">
              Are you sure you want to delete <span className="font-semibold">{deleteCustomerDialog.name}</span>?
            </p>
            <p className="text-xs text-slate-500">
              Customers with any recorded credit sales cannot be deleted.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCustomerDialog((p) => ({ ...p, open: false }))}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteCustomer} disabled={deleteCustomerSaving}>
              {deleteCustomerSaving ? "Deleting..." : "Delete Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Customer Dialog ── */}
      <Dialog
        open={newCustomerDialog.open}
        onOpenChange={(o) => setNewCustomerDialog((p) => ({ ...p, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Full Name *</Label>
              <Input
                value={newCustomerDialog.name}
                onChange={(e) => setNewCustomerDialog((p) => ({ ...p, name: e.target.value }))}
                placeholder="Customer name"
                autoFocus
              />
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input
                value={newCustomerDialog.phone}
                onChange={(e) =>
                  setNewCustomerDialog((p) => ({ ...p, phone: e.target.value }))
                }
                placeholder="0XX XXX XXXX"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={newCustomerDialog.notes}
                onChange={(e) =>
                  setNewCustomerDialog((p) => ({ ...p, notes: e.target.value }))
                }
                placeholder="Any additional info"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewCustomerDialog((p) => ({ ...p, open: false }))}
            >
              Cancel
            </Button>
            <Button onClick={handleAddCustomer} disabled={customerSaving}>
              {customerSaving ? "Saving..." : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
