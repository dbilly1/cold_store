"use client";

import React, { useState, useMemo } from "react";
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
import {
  Plus,
  Phone,
  User,
  Wallet,
  Pencil,
  Trash2,
  ArrowLeft,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { TablePagination } from "@/components/ui/table-pagination";

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
  quantity_kg: number;
  quantity_units: number;
  quantity_boxes: number;
  unit_price: number;
  discount_amount: number;
  product: { name: string; unit_type: string } | null;
}

interface CreditSale {
  id: string;
  sale_date: string;
  total_amount: number;
  customer_id: string;
  created_at: string;
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
  collected_at_till: boolean;
  created_at: string;
  recorded_by_profile: { full_name: string } | null;
}

type LedgerEntry =
  | { type: "sale"; date: string; sortKey: string; id: string; data: CreditSale; balance: number }
  | { type: "payment"; date: string; sortKey: string; id: string; data: CreditPayment; balance: number };

function formatItemQty(item: CreditSaleItem): string {
  const ut = item.product?.unit_type;
  const kg = item.quantity_kg ?? 0;
  const units = item.quantity_units ?? 0;
  const boxes = item.quantity_boxes ?? 0;
  const pluralBox = (n: number) => `${n} box${n !== 1 ? "es" : ""}`;

  if (ut === "kg") {
    const parts: string[] = [];
    if (kg > 0) parts.push(`${kg} kg`);
    if (boxes > 0) parts.push(pluralBox(boxes));
    return parts.join(" + ") || "—";
  }
  if (ut === "units") {
    const parts: string[] = [];
    if (units > 0) parts.push(`${units} unit${units !== 1 ? "s" : ""}`);
    if (boxes > 0) parts.push(pluralBox(boxes));
    return parts.join(" + ") || "—";
  }
  // boxes
  return boxes > 0 ? pluralBox(boxes) : "—";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerPageSize, setLedgerPageSize] = useState(25);

  // Payment dialog
  const [paymentDialog, setPaymentDialog] = useState({
    open: false,
    customerId: "",
    amount: "",
    method: "cash" as "cash" | "mobile_money",
    date: new Date().toISOString().split("T")[0],
    notes: "",
    collectedAtTill: false,
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

  // Edit payment dialog
  const [editPaymentDialog, setEditPaymentDialog] = useState({
    open: false,
    id: "",
    amount: "",
    method: "cash" as "cash" | "mobile_money",
    date: "",
    notes: "",
    collectedAtTill: false,
  });
  const [editPaymentSaving, setEditPaymentSaving] = useState(false);

  // Delete payment dialog
  const [deletePaymentDialog, setDeletePaymentDialog] = useState({
    open: false,
    id: "",
    amount: 0,
  });
  const [deletePaymentSaving, setDeletePaymentSaving] = useState(false);

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

  const filteredCustomers = sortedCustomers.filter(
    (c) =>
      !searchQuery ||
      c.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.phone && c.phone.includes(searchQuery)),
  );

  const activeCustomers = filteredCustomers.filter(
    (c) => getBalance(c.id).outstanding > 0.005,
  );
  const settledCustomers = filteredCustomers.filter(
    (c) => getBalance(c.id).outstanding <= 0.005,
  );

  const selectedCustomer =
    customers.find((c) => c.id === selectedCustomerId) ?? null;
  const selectedBalance = selectedCustomerId
    ? getBalance(selectedCustomerId)
    : null;
  const selectedSales = creditSales.filter(
    (s) => s.customer_id === selectedCustomerId,
  );
  const selectedPayments = payments.filter(
    (p) => p.customer_id === selectedCustomerId,
  );

  // Build unified ledger (ascending for running balance, reversed for display)
  const combinedRaw: Omit<LedgerEntry, "balance">[] = [
    ...selectedSales.map((s) => ({
      type: "sale" as const,
      date: s.sale_date,
      sortKey: s.sale_date + (s.created_at ?? ""),
      id: s.id,
      data: s,
    })),
    ...selectedPayments.map((p) => ({
      type: "payment" as const,
      date: p.payment_date,
      sortKey: p.payment_date + (p.created_at ?? ""),
      id: p.id,
      data: p,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  let runBal = 0;
  const ledger: LedgerEntry[] = combinedRaw.map((entry) => {
    if (entry.type === "sale") runBal += (entry.data as CreditSale).total_amount;
    else runBal -= (entry.data as CreditPayment).amount;
    return { ...entry, balance: runBal } as LedgerEntry;
  });
  const displayLedger = [...ledger].reverse();
  const pagedLedger = useMemo(
    () => displayLedger.slice(ledgerPage * ledgerPageSize, (ledgerPage + 1) * ledgerPageSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayLedger.length, ledgerPage, ledgerPageSize, selectedCustomerId],
  );

  function selectCustomer(id: string) {
    setSelectedCustomerId(id);
    setMobileView("detail");
    setExpandedSaleId(null);
    setLedgerPage(0);
  }

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
        collected_at_till: paymentDialog.collectedAtTill,
      })
      .select(
        "id, customer_id, amount, payment_method, payment_date, notes, collected_at_till, created_at",
      )
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

    const { error: auditErr } = await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "RECORD_CREDIT_PAYMENT",
      entity_type: "credit_payments",
      entity_id: (data as { id: string }).id,
      new_value: { customer_id: paymentDialog.customerId, amount: amt },
    });
    if (auditErr) {
      console.warn("Audit log insert failed:", auditErr.message);
      toast({
        title: "Payment saved — audit log failed",
        description:
          "The payment was recorded but the audit trail entry failed. Please notify your administrator.",
        variant: "default",
      });
    }

    setPayments((prev) => [
      { ...(data as unknown as CreditPayment), recorded_by_profile: null },
      ...prev,
    ]);
    toast({ title: "Payment recorded" });
    setPaymentDialog((p) => ({
      ...p,
      open: false,
      amount: "",
      notes: "",
      collectedAtTill: false,
    }));
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
      [...prev, newCust].sort((a, b) =>
        a.full_name.localeCompare(b.full_name),
      ),
    );
    selectCustomer(newCust.id);
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
      toast({
        title: "Failed to update customer",
        description: error.message,
        variant: "destructive",
      });
      setEditCustomerSaving(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "UPDATE_CUSTOMER",
      entity_type: "customers",
      entity_id: editCustomerDialog.id,
      new_value: {
        full_name: editCustomerDialog.name.trim(),
        phone: editCustomerDialog.phone.trim() || null,
      },
    });

    setCustomers((prev) =>
      prev
        .map((c) =>
          c.id === editCustomerDialog.id
            ? {
                ...c,
                full_name: editCustomerDialog.name.trim(),
                phone: editCustomerDialog.phone.trim() || null,
                notes: editCustomerDialog.notes.trim() || null,
              }
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
        description:
          "This customer has credit sales on record. Clear their history first.",
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
      toast({
        title: "Failed to delete customer",
        description: error.message,
        variant: "destructive",
      });
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

    setCustomers((prev) =>
      prev.filter((c) => c.id !== deleteCustomerDialog.id),
    );
    if (selectedCustomerId === deleteCustomerDialog.id) {
      setSelectedCustomerId(null);
      setMobileView("list");
    }
    toast({ title: "Customer deleted" });
    setDeleteCustomerDialog((p) => ({ ...p, open: false }));
    setDeleteCustomerSaving(false);
  }

  async function handleEditPayment() {
    const amt = parseFloat(editPaymentDialog.amount);
    if (!amt || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setEditPaymentSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("credit_payments")
      .update({
        amount: amt,
        payment_method: editPaymentDialog.method,
        payment_date: editPaymentDialog.date,
        notes: editPaymentDialog.notes || null,
        collected_at_till: editPaymentDialog.collectedAtTill,
      })
      .eq("id", editPaymentDialog.id);

    if (error) {
      toast({ title: "Failed to update payment", description: error.message, variant: "destructive" });
      setEditPaymentSaving(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "UPDATE_CREDIT_PAYMENT",
      entity_type: "credit_payments",
      entity_id: editPaymentDialog.id,
      new_value: { amount: amt, payment_method: editPaymentDialog.method, payment_date: editPaymentDialog.date },
    });

    setPayments((prev) =>
      prev.map((p) =>
        p.id === editPaymentDialog.id
          ? {
              ...p,
              amount: amt,
              payment_method: editPaymentDialog.method,
              payment_date: editPaymentDialog.date,
              notes: editPaymentDialog.notes || null,
              collected_at_till: editPaymentDialog.collectedAtTill,
            }
          : p,
      ),
    );
    toast({ title: "Payment updated" });
    setEditPaymentDialog((p) => ({ ...p, open: false }));
    setEditPaymentSaving(false);
  }

  async function handleDeletePayment() {
    setDeletePaymentSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("credit_payments")
      .delete()
      .eq("id", deletePaymentDialog.id);

    if (error) {
      toast({ title: "Failed to delete payment", description: error.message, variant: "destructive" });
      setDeletePaymentSaving(false);
      return;
    }

    await supabase.from("audit_logs").insert({
      user_id: profile!.id,
      action: "DELETE_CREDIT_PAYMENT",
      entity_type: "credit_payments",
      entity_id: deletePaymentDialog.id,
      new_value: { amount: deletePaymentDialog.amount },
    });

    setPayments((prev) => prev.filter((p) => p.id !== deletePaymentDialog.id));
    toast({ title: "Payment deleted" });
    setDeletePaymentDialog((p) => ({ ...p, open: false }));
    setDeletePaymentSaving(false);
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
      {/* ── Left panel: customer list ── */}
      <div
        className={`${
          mobileView === "detail" ? "hidden lg:flex" : "flex"
        } w-full lg:w-72 border-b lg:border-b-0 lg:border-r bg-white flex-col overflow-hidden flex-shrink-0`}
      >
        {/* Header */}
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

        {/* Search */}
        <div className="px-3 py-2.5 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-8 h-9 text-sm"
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredCustomers.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">
              {searchQuery ? "No matches found" : "No customers yet"}
            </p>
          )}

          {/* Active (outstanding balance) */}
          {activeCustomers.map((customer) => {
            const { outstanding } = getBalance(customer.id);
            const isSelected = selectedCustomerId === customer.id;
            return (
              <button
                key={customer.id}
                onClick={() => selectCustomer(customer.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  isSelected
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800 text-sm truncate">
                    {customer.full_name}
                  </p>
                  <Badge variant="destructive" className="text-xs flex-shrink-0">
                    {formatCurrency(outstanding)}
                  </Badge>
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

          {/* Settled section */}
          {settledCustomers.length > 0 && (
            <>
              {activeCustomers.length > 0 && (
                <div className="pt-3 pb-1">
                  <p className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase px-1">
                    Settled
                  </p>
                </div>
              )}
              {settledCustomers.map((customer) => {
                const isSelected = selectedCustomerId === customer.id;
                return (
                  <button
                    key={customer.id}
                    onClick={() => selectCustomer(customer.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-100 bg-slate-50 hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-slate-500 text-sm truncate">
                        {customer.full_name}
                      </p>
                      <Badge
                        variant="secondary"
                        className="text-xs bg-green-100 text-green-700 flex-shrink-0"
                      >
                        Settled
                      </Badge>
                    </div>
                    {customer.phone && (
                      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {customer.phone}
                      </p>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: customer ledger ── */}
      <div
        className={`${
          mobileView === "list" ? "hidden lg:flex" : "flex"
        } flex-1 flex-col overflow-hidden`}
      >
        {!selectedCustomer ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <User className="h-12 w-12 mb-3" />
            <p className="text-lg font-medium">Select a customer</p>
            <p className="text-sm">View their credit history and record payments</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 bg-white border-b px-4 md:px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Back button — mobile only */}
                  <button
                    className="lg:hidden p-1.5 -ml-1 rounded-md hover:bg-slate-100 text-slate-600 flex-shrink-0"
                    onClick={() => setMobileView("list")}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-slate-800 truncate">
                      {selectedCustomer.full_name}
                    </h2>
                    {selectedCustomer.phone && (
                      <p className="text-slate-500 flex items-center gap-1 mt-0.5 text-sm">
                        <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                        {selectedCustomer.phone}
                      </p>
                    )}
                    {selectedCustomer.notes && (
                      <p className="text-slate-400 text-xs mt-1">
                        {selectedCustomer.notes}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
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
                        collectedAtTill: false,
                      })
                    }
                  >
                    <Wallet className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Record Payment</span>
                  </Button>
                </div>
              </div>
            </div>

            <div className="p-4 md:p-6 space-y-6">
              {/* Balance summary cards */}
              {selectedBalance && (
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  <Card>
                    <CardContent className="p-2 sm:p-4">
                      <p className="text-[10px] sm:text-xs text-slate-500 mb-1 leading-tight">
                        Total Credit
                      </p>
                      <p className="text-sm sm:text-lg font-bold text-slate-800 truncate">
                        {formatCurrency(selectedBalance.totalCredit)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-2 sm:p-4">
                      <p className="text-[10px] sm:text-xs text-slate-500 mb-1 leading-tight">
                        Paid Back
                      </p>
                      <p className="text-sm sm:text-lg font-bold text-green-600 truncate">
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
                    <CardContent className="p-2 sm:p-4">
                      <p className="text-[10px] sm:text-xs text-slate-500 mb-1 leading-tight">Outstanding</p>
                      <p
                        className={`text-sm sm:text-lg font-bold truncate ${
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

              {/* Unified transaction ledger */}
              <div>
                <h3 className="font-semibold text-slate-700 mb-3">
                  Transaction History
                </h3>
                {displayLedger.length === 0 ? (
                  <p className="text-sm text-slate-400">No transactions recorded</p>
                ) : (
                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b">
                        <tr>
                          <th className="text-left p-3 font-medium text-slate-600 whitespace-nowrap">Date</th>
                          <th className="text-left p-3 font-medium text-slate-600">Type</th>
                          <th className="text-left p-3 font-medium text-slate-600">Description</th>
                          <th className="text-right p-3 font-medium text-slate-600 whitespace-nowrap">Amount</th>
                          <th className="text-right p-3 font-medium text-slate-600 whitespace-nowrap">Balance</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pagedLedger.map((entry) => {
                          const isSale = entry.type === "sale";
                          const sale = isSale ? (entry.data as CreditSale) : null;
                          const payment = !isSale ? (entry.data as CreditPayment) : null;
                          const isExpanded = isSale && expandedSaleId === entry.id;
                          const balanceOwed = entry.balance > 0.005;

                          return (
                            <React.Fragment key={entry.id}>
                              <tr
                                className={`transition-colors hover:bg-slate-50 ${isSale ? "cursor-pointer" : ""} ${isExpanded ? "bg-slate-50" : ""}`}
                                onClick={isSale ? () => setExpandedSaleId(expandedSaleId === entry.id ? null : entry.id) : undefined}
                              >
                                <td className="p-3 text-slate-600 whitespace-nowrap">
                                  {formatDate(entry.date)}
                                </td>
                                <td className="p-3">
                                  {isSale ? (
                                    <Badge variant="secondary" className="bg-slate-100 text-slate-700">Sale</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="bg-green-100 text-green-700">Payment</Badge>
                                  )}
                                </td>
                                <td className="p-3 text-slate-700">
                                  {isSale && sale ? (
                                    <span>
                                      {(sale.items ?? []).map((i) => i.product?.name).filter(Boolean).slice(0, 3).join(", ")}
                                      {(sale.items ?? []).length > 3 && (
                                        <span className="text-slate-400"> +{(sale.items ?? []).length - 3} more</span>
                                      )}
                                    </span>
                                  ) : payment ? (
                                    <span className="flex items-center gap-2 flex-wrap">
                                      <span>{payment.payment_method === "cash" ? "Cash" : "Mobile Money"}</span>
                                      {payment.collected_at_till && (
                                        <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-[10px]">Till</Badge>
                                      )}
                                      {payment.notes && (
                                        <span className="text-slate-400 text-xs">· {payment.notes}</span>
                                      )}
                                    </span>
                                  ) : null}
                                </td>
                                <td className={`p-3 text-right font-medium whitespace-nowrap ${isSale ? "text-red-600" : "text-green-600"}`}>
                                  {isSale ? formatCurrency(sale!.total_amount) : formatCurrency(payment!.amount)}
                                </td>
                                <td className={`p-3 text-right font-semibold whitespace-nowrap ${balanceOwed ? "text-red-600" : "text-green-600"}`}>
                                  {formatCurrency(entry.balance)}
                                </td>
                                <td className="p-3 text-center text-slate-400">
                                  {isSale && (isExpanded ? <ChevronUp className="h-4 w-4 inline" /> : <ChevronDown className="h-4 w-4 inline" />)}
                                  {!isSale && payment && (
                                    <div
                                      className="flex items-center justify-end gap-0.5"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        className="p-1.5 rounded hover:bg-slate-100 text-slate-300 hover:text-slate-600 transition-colors"
                                        title="Edit payment"
                                        onClick={() =>
                                          setEditPaymentDialog({
                                            open: true,
                                            id: payment.id,
                                            amount: payment.amount.toString(),
                                            method: payment.payment_method as "cash" | "mobile_money",
                                            date: payment.payment_date,
                                            notes: payment.notes ?? "",
                                            collectedAtTill: payment.collected_at_till,
                                          })
                                        }
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        className="p-1.5 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                                        title="Delete payment"
                                        onClick={() =>
                                          setDeletePaymentDialog({
                                            open: true,
                                            id: payment.id,
                                            amount: payment.amount,
                                          })
                                        }
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>

                              {/* Expanded sale item breakdown */}
                              {isExpanded && sale && (
                                <tr>
                                  <td
                                    colSpan={6}
                                    className="bg-blue-50/40 px-6 py-4 border-b border-blue-100"
                                  >
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                                      Items in this sale
                                    </p>
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-xs text-slate-500 border-b border-blue-100">
                                          <th className="text-left pb-2 font-medium">
                                            Product
                                          </th>
                                          <th className="text-left pb-2 font-medium px-4">
                                            Qty
                                          </th>
                                          <th className="text-right pb-2 font-medium px-4">
                                            Unit Price
                                          </th>
                                          <th className="text-right pb-2 font-medium px-4">
                                            Discount
                                          </th>
                                          <th className="text-right pb-2 font-medium">
                                            Line Total
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(sale.items ?? []).map((item) => (
                                          <tr
                                            key={item.id}
                                            className="border-b border-blue-50 last:border-0"
                                          >
                                            <td className="py-2 pr-4 text-slate-800 font-medium">
                                              {item.product?.name ?? "—"}
                                            </td>
                                            <td className="py-2 px-4 text-slate-600">
                                              {formatItemQty(item)}
                                            </td>
                                            <td className="py-2 px-4 text-right text-slate-600">
                                              {formatCurrency(item.unit_price)}
                                            </td>
                                            <td className="py-2 px-4 text-right text-slate-400">
                                              {item.discount_amount > 0
                                                ? `−${formatCurrency(item.discount_amount)}`
                                                : "—"}
                                            </td>
                                            <td className="py-2 text-right font-semibold text-slate-800">
                                              {formatCurrency(item.line_total)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {sale.recorded_by_profile?.full_name && (
                                      <p className="text-xs text-slate-400 mt-3">
                                        Recorded by{" "}
                                        {sale.recorded_by_profile.full_name}
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    {displayLedger.length > 0 && (
                      <TablePagination
                        total={displayLedger.length}
                        page={ledgerPage}
                        pageSize={ledgerPageSize}
                        onPageChange={(p) => { setLedgerPage(p); setExpandedSaleId(null); }}
                        onPageSizeChange={(s) => { setLedgerPageSize(s); setLedgerPage(0); setExpandedSaleId(null); }}
                      />
                    )}
                  </div>
                )}
              </div>
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
              {customers.find((c) => c.id === paymentDialog.customerId)
                ?.full_name}
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
                onChange={(e) =>
                  setPaymentDialog((p) => ({ ...p, amount: e.target.value }))
                }
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
                onChange={(e) =>
                  setPaymentDialog((p) => ({ ...p, date: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={paymentDialog.notes}
                onChange={(e) =>
                  setPaymentDialog((p) => ({ ...p, notes: e.target.value }))
                }
                placeholder="Any notes..."
              />
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50 select-none">
              <input
                type="checkbox"
                className="mt-0.5 rounded"
                checked={paymentDialog.collectedAtTill}
                onChange={(e) =>
                  setPaymentDialog((p) => ({
                    ...p,
                    collectedAtTill: e.target.checked,
                  }))
                }
              />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Received at shop
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {paymentDialog.method === "cash"
                    ? "Tick this if the cash is physically in the till."
                    : "Tick this if the payment was sent to the shop's mobile account."}
                  {" "}
                  This will include it in daily reconciliation.
                </p>
              </div>
            </label>
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
                onChange={(e) =>
                  setEditCustomerDialog((p) => ({
                    ...p,
                    name: e.target.value,
                  }))
                }
                placeholder="Customer name"
                autoFocus
              />
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input
                value={editCustomerDialog.phone}
                onChange={(e) =>
                  setEditCustomerDialog((p) => ({
                    ...p,
                    phone: e.target.value,
                  }))
                }
                placeholder="0XX XXX XXXX"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={editCustomerDialog.notes}
                onChange={(e) =>
                  setEditCustomerDialog((p) => ({
                    ...p,
                    notes: e.target.value,
                  }))
                }
                placeholder="Any additional info"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setEditCustomerDialog((p) => ({ ...p, open: false }))
              }
            >
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
        onOpenChange={(o) =>
          setDeleteCustomerDialog((p) => ({ ...p, open: o }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-slate-700">
              Are you sure you want to delete{" "}
              <span className="font-semibold">{deleteCustomerDialog.name}</span>
              ?
            </p>
            <p className="text-xs text-slate-500">
              Customers with any recorded credit sales cannot be deleted.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setDeleteCustomerDialog((p) => ({ ...p, open: false }))
              }
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCustomer}
              disabled={deleteCustomerSaving}
            >
              {deleteCustomerSaving ? "Deleting..." : "Delete Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Payment Dialog ── */}
      <Dialog
        open={editPaymentDialog.open}
        onOpenChange={(o) => setEditPaymentDialog((p) => ({ ...p, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Amount (GHS)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={editPaymentDialog.amount}
                onChange={(e) =>
                  setEditPaymentDialog((p) => ({ ...p, amount: e.target.value }))
                }
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select
                value={editPaymentDialog.method}
                onValueChange={(v) =>
                  setEditPaymentDialog((p) => ({
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
                value={editPaymentDialog.date}
                onChange={(e) =>
                  setEditPaymentDialog((p) => ({ ...p, date: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={editPaymentDialog.notes}
                onChange={(e) =>
                  setEditPaymentDialog((p) => ({ ...p, notes: e.target.value }))
                }
                placeholder="Any notes..."
              />
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50 select-none">
              <input
                type="checkbox"
                className="mt-0.5 rounded"
                checked={editPaymentDialog.collectedAtTill}
                onChange={(e) =>
                  setEditPaymentDialog((p) => ({
                    ...p,
                    collectedAtTill: e.target.checked,
                  }))
                }
              />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Received at shop
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editPaymentDialog.method === "cash"
                    ? "Tick this if the cash is physically in the till."
                    : "Tick this if the payment was sent to the shop's mobile account."}
                  {" "}
                  This will include it in daily reconciliation.
                </p>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditPaymentDialog((p) => ({ ...p, open: false }))}
            >
              Cancel
            </Button>
            <Button onClick={handleEditPayment} disabled={editPaymentSaving}>
              {editPaymentSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Payment Dialog ── */}
      <Dialog
        open={deletePaymentDialog.open}
        onOpenChange={(o) => setDeletePaymentDialog((p) => ({ ...p, open: o }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payment</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-slate-700">
              Are you sure you want to delete this payment of{" "}
              <span className="font-semibold">{formatCurrency(deletePaymentDialog.amount)}</span>?
            </p>
            <p className="text-xs text-slate-500">
              This will adjust the customer&apos;s outstanding balance accordingly.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletePaymentDialog((p) => ({ ...p, open: false }))}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeletePayment}
              disabled={deletePaymentSaving}
            >
              {deletePaymentSaving ? "Deleting..." : "Delete Payment"}
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
                onChange={(e) =>
                  setNewCustomerDialog((p) => ({ ...p, name: e.target.value }))
                }
                placeholder="Customer name"
                autoFocus
              />
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input
                value={newCustomerDialog.phone}
                onChange={(e) =>
                  setNewCustomerDialog((p) => ({
                    ...p,
                    phone: e.target.value,
                  }))
                }
                placeholder="0XX XXX XXXX"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={newCustomerDialog.notes}
                onChange={(e) =>
                  setNewCustomerDialog((p) => ({
                    ...p,
                    notes: e.target.value,
                  }))
                }
                placeholder="Any additional info"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setNewCustomerDialog((p) => ({ ...p, open: false }))
              }
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
