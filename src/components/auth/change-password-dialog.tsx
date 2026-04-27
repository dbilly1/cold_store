"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, EyeOff } from "lucide-react";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.next !== form.confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" }); return;
    }
    if (form.next.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return;
    }
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user!.email!,
      password: form.current,
    });
    if (verifyErr) {
      toast({ title: "Current password is incorrect", variant: "destructive" });
      setSaving(false); return;
    }
    const { error } = await supabase.auth.updateUser({ password: form.next });
    if (error) {
      toast({ title: "Failed to update password", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    await supabase.auth.signOut({ scope: "global" });
    router.push("/login?reason=password_changed");
  }

  const fields = [
    { key: "current" as const, label: "Current Password" },
    { key: "next" as const, label: "New Password" },
    { key: "confirm" as const, label: "Confirm New Password" },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Change Password</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <div className="relative">
                <Input
                  type={show[key] ? "text" : "password"}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="pr-10"
                  required
                  minLength={key !== "current" ? 8 : undefined}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShow({ ...show, [key]: !show[key] })}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {show[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
