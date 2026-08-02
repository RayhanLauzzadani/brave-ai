"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { logout as logoutApi } from "@/lib/api/auth";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { cn } from "@/lib/utils";

interface LogoutButtonProps {
  className?: string;
  label?: string;
  compact?: boolean;
}

export function LogoutButton({
  className,
  label = "Keluar",
  compact = false,
}: LogoutButtonProps) {
  const router = useRouter();
  const clearAlerts = useAlertStore((state) => state.clearAlerts);
  const clearSession = useAuthStore((state) => state.logout);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      await logoutApi();
    } catch {
      // Local session must still be cleared when the API is unavailable.
    } finally {
      clearAlerts();
      clearSession();
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      disabled={isLoggingOut}
      aria-label={compact ? "Keluar dari akun" : undefined}
      title={compact ? "Keluar dari akun" : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-colors disabled:cursor-wait disabled:opacity-60",
        className,
      )}
    >
      {isLoggingOut ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogOut className="h-4 w-4" />
      )}
      {!compact && (isLoggingOut ? "Keluar..." : label)}
    </button>
  );
}
