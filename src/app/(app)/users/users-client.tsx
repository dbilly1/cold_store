"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useProfile } from "@/hooks/use-profile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDateTime, getRoleLabel, getRoleBadgeColor } from "@/lib/utils";
import { CheckCircle, XCircle, UserCheck, Trash2 } from "lucide-react";
import type { Profile, UserRole } from "@/types/database";

export function UsersClient({ users: initial }: { users: Profile[] }) {
  const { toast } = useToast();
  const { profile: currentUser } = useProfile();
  const [users, setUsers] = useState<Profile[]>(initial);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    userId: string;
    userName: string;
  }>({ open: false, userId: "", userName: "" });
  const [deleting, setDeleting] = useState(false);

  async function approve(userId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ is_approved: true, approved_by: currentUser!.id, approved_at: new Date().toISOString() })
      .eq("id", userId);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setUsers(users.map(u => u.id === userId ? { ...u, is_approved: true } : u));
    toast({ title: "User approved" });
  }

  async function revoke(userId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ is_approved: false }).eq("id", userId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setUsers(users.map(u => u.id === userId ? { ...u, is_approved: false } : u));
    toast({ title: "Access revoked" });
  }

  async function changeRole(userId: string, role: UserRole) {
    const supabase = createClient();
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setUsers(users.map(u => u.id === userId ? { ...u, role } : u));
    toast({ title: "Role updated" });
  }

  async function deleteUser() {
    setDeleting(true);
    const res = await fetch(`/api/users/${deleteDialog.userId}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      toast({ title: "Failed to delete user", description: json.error, variant: "destructive" });
      setDeleting(false);
      return;
    }
    setUsers((prev) => prev.filter((u) => u.id !== deleteDialog.userId));
    setDeleteDialog({ open: false, userId: "", userName: "" });
    toast({ title: "User deleted", description: `${deleteDialog.userName} has been removed from the system.` });
    setDeleting(false);
  }

  const isAdmin = currentUser?.role === "admin";
  const pending = users.filter(u => !u.is_approved);
  const approved = users.filter(u => u.is_approved);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
      {/* Pending approvals */}
      {pending.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-amber-500" />
            Pending Approval ({pending.length})
          </h2>
          <div className="bg-amber-50 rounded-lg border border-amber-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-100 border-b border-amber-200">
                <tr>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">Requested Role</th>
                  <th className="text-left p-3 font-medium">Requested</th>
                  <th className="text-center p-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {pending.map((user) => (
                  <tr key={user.id}>
                    <td className="p-3 font-medium">{user.full_name}</td>
                    <td className="p-3 text-slate-600">{user.email}</td>
                    <td className="p-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-slate-500">{formatDateTime(user.created_at)}</td>
                    <td className="p-3">
                      <div className="flex justify-center gap-2">
                        <Button size="sm" onClick={() => approve(user.id)} className="h-7">
                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => revoke(user.id)} className="h-7">
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                        </Button>
                        {isAdmin && (
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteDialog({ open: true, userId: user.id, userName: user.full_name })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All users */}
      <div>
        <h2 className="font-semibold mb-3">Active Users ({approved.length})</h2>
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium text-slate-600">Name</th>
                <th className="text-left p-3 font-medium text-slate-600">Email</th>
                <th className="text-left p-3 font-medium text-slate-600">Role</th>
                <th className="text-left p-3 font-medium text-slate-600">Joined</th>
                <th className="text-center p-3 font-medium text-slate-600">Status</th>
                <th className="text-center p-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="p-3 font-medium">{user.full_name}</td>
                  <td className="p-3 text-slate-600">{user.email}</td>
                  <td className="p-3">
                    {user.id === currentUser?.id ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                        {getRoleLabel(user.role)}
                      </span>
                    ) : (
                      <Select value={user.role} onValueChange={(v) => changeRole(user.id, v as UserRole)}>
                        <SelectTrigger className="h-7 w-full sm:w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="salesperson">Salesperson</SelectItem>
                          <SelectItem value="supervisor">Supervisor</SelectItem>
                          <SelectItem value="accountant">Accountant</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="p-3 text-xs text-slate-500">{formatDateTime(user.created_at)}</td>
                  <td className="p-3 text-center">
                    <Badge variant={user.is_approved ? "success" : "warning"}>
                      {user.is_approved ? "Active" : "Pending"}
                    </Badge>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex justify-center items-center gap-1">
                      {user.id !== currentUser?.id && user.is_approved && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600 hover:text-red-700" onClick={() => revoke(user.id)}>
                          Revoke
                        </Button>
                      )}
                      {user.id !== currentUser?.id && !user.is_approved && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-green-600" onClick={() => approve(user.id)}>
                          Approve
                        </Button>
                      )}
                      {isAdmin && user.id !== currentUser?.id && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Delete user"
                          onClick={() => setDeleteDialog({ open: true, userId: user.id, userName: user.full_name })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false, userId: "", userName: "" })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> Delete User
            </DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-slate-700">
              Are you sure you want to delete{" "}
              <span className="font-semibold">{deleteDialog.userName}</span>?
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Their account, login credentials, and profile will be permanently removed from the system.
              Sales and other records they created will remain.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, userId: "", userName: "" })} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteUser} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
