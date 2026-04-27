"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Snowflake, Clock, Eye, EyeOff, ShieldCheck } from "lucide-react";

// ── Banners — isolated so useSearchParams is inside Suspense ──
function StatusBanner() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const reason = searchParams.get("reason");
  const error = searchParams.get("error");
  const timedOut = reason === "timeout";
  const passwordChanged = reason === "password_changed";
  const invalidLink = error === "invalid_link";

  useEffect(() => {
    if (timedOut) {
      toast({
        title: "Signed out due to inactivity",
        description: "Your session expired after 30 minutes of inactivity. Please sign in again.",
        variant: "destructive",
      });
    }
  }, [timedOut, toast]);

  if (timedOut) return (
    <div className="mx-6 mb-2 flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
      <Clock className="h-4 w-4 flex-shrink-0" />
      You were signed out after 30 minutes of inactivity.
    </div>
  );

  if (passwordChanged) return (
    <div className="mx-6 mb-2 flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
      <ShieldCheck className="h-4 w-4 flex-shrink-0" />
      Password updated. All sessions have been signed out. Please sign in again.
    </div>
  );

  if (invalidLink) return (
    <div className="mx-6 mb-2 flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
      <ShieldCheck className="h-4 w-4 flex-shrink-0" />
      That reset link is invalid or has expired. Please request a new one.
    </div>
  );

  return null;
}

// ── Main login page ───────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_approved")
      .eq("id", user!.id)
      .single();

    if (!profile?.is_approved) {
      await supabase.auth.signOut();
      router.push("/pending-approval");
      return;
    }

    setLoading(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-2">
            <div className="h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
              <Snowflake className="h-6 w-6 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl">Cold Store</CardTitle>
          <CardDescription>Sign in to manage inventory & sales</CardDescription>
        </CardHeader>

        {/* Suspense required by Next.js whenever useSearchParams is used */}
        <Suspense fallback={null}>
          <StatusBanner />
        </Suspense>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary hover:underline">
                Request access
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
