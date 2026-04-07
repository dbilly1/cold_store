"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface AddCustomerDialogProps {
  open: boolean;
  name: string;
  phone: string;
  saving: boolean;
  onChange: (patch: Partial<{ name: string; phone: string }>) => void;
  onSave: () => void;
  onClose: () => void;
}

export function AddCustomerDialog({
  open,
  name,
  phone,
  saving,
  onChange,
  onSave,
  onClose,
}: AddCustomerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Customer</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Full Name *</Label>
            <Input
              value={name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Customer name"
            />
          </div>
          <div>
            <Label>Phone Number</Label>
            <Input
              value={phone}
              onChange={(e) => onChange({ phone: e.target.value })}
              placeholder="0XX XXX XXXX"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Add Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
