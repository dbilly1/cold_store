"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogOut, Clock } from "lucide-react";

// ── Config ────────────────────────────────────────────────────
const INACTIVITY_MS  = 30 * 60 * 1000;  // 30 min → auto-logout
const WARNING_MS     =  2 * 60 * 1000;  // warn 2 min before logout
const ABSOLUTE_MS    = 24 * 60 * 60 * 1000; // 24 hr hard limit

const ACTIVITY_EVENTS = [
  "mousedown", "mousemove", "keydown",
  "touchstart", "scroll", "click",
] as const;

// ── Component ─────────────────────────────────────────────────
export function SessionTimeout() {
  const router = useRouter();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown]     = useState(120);

  const warningTimer   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const logoutTimer    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const absoluteTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const warningShowing = useRef(false);

  // ── Sign out ─────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    clearTimeout(warningTimer.current);
    clearTimeout(logoutTimer.current);
    clearInterval(countdownTimer.current);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("signOut error:", err);
    }
    router.push("/login?reason=timeout");
  }, [router]);

  // ── Reset inactivity timers ───────────────────────────────────
  const resetTimers = useCallback(() => {
    if (warningShowing.current) return; // don't interrupt the warning
    clearTimeout(warningTimer.current);
    clearTimeout(logoutTimer.current);

    warningTimer.current = setTimeout(() => {
      warningShowing.current = true;
      setShowWarning(true);
      setCountdown(120);
    }, INACTIVITY_MS - WARNING_MS);

    logoutTimer.current = setTimeout(() => {
      signOut();
    }, INACTIVITY_MS);
  }, [signOut]);

  // ── Stay logged in ────────────────────────────────────────────
  const stayLoggedIn = useCallback(() => {
    warningShowing.current = false;
    setShowWarning(false);
    clearInterval(countdownTimer.current);
    resetTimers();
  }, [resetTimers]);

  // ── Attach activity listeners + absolute timer ────────────────
  useEffect(() => {
    const onActivity = () => resetTimers();
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true })
    );
    resetTimers(); // kick off on mount

    absoluteTimer.current = setTimeout(() => signOut(), ABSOLUTE_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) =>
        window.removeEventListener(e, onActivity)
      );
      clearTimeout(warningTimer.current);
      clearTimeout(logoutTimer.current);
      clearTimeout(absoluteTimer.current);
      clearInterval(countdownTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount

  // ── Countdown tick when warning is visible ────────────────────
  useEffect(() => {
    if (!showWarning) return;
    countdownTimer.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimer.current);
          signOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(countdownTimer.current);
  }, [showWarning, signOut]);

  if (!showWarning) return null;

  const mins = Math.floor(countdown / 60);
  const secs = String(countdown % 60).padStart(2, "0");

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-5 w-5 text-amber-500" />
            <DialogTitle>Still there?</DialogTitle>
          </div>
          <DialogDescription>
            You've been inactive for a while. You'll be automatically signed
            out in{" "}
            <span className="font-semibold text-foreground">
              {mins}:{secs}
            </span>{" "}
            to keep your account secure.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 justify-end mt-2">
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-1.5" />
            Sign out now
          </Button>
          <Button size="sm" onClick={stayLoggedIn}>
            Stay signed in
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
