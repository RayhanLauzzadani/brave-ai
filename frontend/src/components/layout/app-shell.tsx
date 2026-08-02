"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Volume2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileBottomNav } from "./mobile-nav";
import { getAlerts, subscribeAlerts } from "@/lib/api/alerts";
import { getUser } from "@/lib/api/auth";
import {
  playIncidentAlarm,
  unlockNotificationSound,
} from "@/lib/notification-sound";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useNotificationPreferencesStore } from "@/lib/stores/notification-preferences-store";
import { useUiStore } from "@/lib/stores/ui-store";
import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOUNDED_ALERTS_KEY = "brave-ai-sounded-alerts";

export function AppShell({ children }: { children: React.ReactNode }) {
  const alerts = useAlertStore((state) => state.alerts);
  const setAlerts = useAlertStore((state) => state.setAlerts);
  const addAlert = useAlertStore((state) => state.addAlert);
  const clearAlerts = useAlertStore((state) => state.clearAlerts);
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const clearSession = useAuthStore((state) => state.logout);
  const soundEnabled = useNotificationPreferencesStore(
    (state) => state.soundEnabled,
  );
  const soundPreferencesHydrated = useNotificationPreferencesStore(
    (state) => state.hasHydrated,
  );
  const pathname = usePathname();
  const router = useRouter();
  const isCollapsed = useUiStore((state) => state.isSidebarCollapsed);
  const [soundBlocked, setSoundBlocked] = useState(false);

  useEffect(() => {
    if (hasHydrated) return;
    void getUser().then(restoreSession);
  }, [hasHydrated, restoreSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearAlerts();
      clearSession();
    };
    window.addEventListener("brave-ai:unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("brave-ai:unauthorized", handleUnauthorized);
    };
  }, [clearAlerts, clearSession]);

  useEffect(() => {
    if (!hasHydrated || isAuthenticated) return;
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [hasHydrated, isAuthenticated, pathname, router]);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated || !user) return;

    let cancelled = false;
    void getAlerts()
      .then((result) => {
        if (!cancelled) setAlerts(result);
      })
      .catch(() => undefined);

    const unsubscribe = subscribeAlerts((alert) => {
      addAlert(alert);
      if (
        user.role !== "viewer"
        || alert.type !== "bullying_detected"
        || !soundEnabled
        || !soundPreferencesHydrated
        || wasAlertSounded(alert.id)
      ) {
        return;
      }

      rememberSoundedAlert(alert.id);
      void playIncidentAlarm().then((played) => {
        if (!played) setSoundBlocked(true);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [
    addAlert,
    hasHydrated,
    isAuthenticated,
    setAlerts,
    soundEnabled,
    soundPreferencesHydrated,
    user,
  ]);

  useEffect(() => {
    if (user?.role !== "viewer" || !soundEnabled) return;
    const unlock = () => {
      void unlockNotificationSound().then((unlocked) => {
        if (unlocked) setSoundBlocked(false);
      });
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [soundEnabled, user?.role]);

  const unreadIncidentAlerts = useMemo(
    () =>
      alerts.filter(
        (alert) => alert.type === "bullying_detected" && !alert.isRead,
      ),
    [alerts],
  );

  if (!hasHydrated) {
    return <SessionState message="Memuat sesi..." />;
  }

  if (!isAuthenticated || !user) {
    return <SessionState message="Mengalihkan ke login..." />;
  }

  const firstIncident = unreadIncidentAlerts[0];

  return (
    <div className="min-h-screen bg-[#060a13]">
      <Sidebar />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300",
          isCollapsed ? "lg:pl-20" : "lg:pl-64",
        )}
      >
        {pathname !== "/dashboard"
          && pathname !== "/live-view"
          && pathname !== "/rekaman"
          && pathname !== "/laporan"
          && pathname !== "/settings" && <Topbar />}
        <main className="flex-1 p-4 pb-20 pwa:p-6 lg:pb-6">{children}</main>
      </div>
      <MobileBottomNav />

      {user.role === "viewer" && (firstIncident || soundBlocked) && (
        <div className="fixed inset-x-3 bottom-[76px] z-[70] mx-auto flex max-w-md flex-col gap-2 lg:bottom-5 lg:left-auto lg:right-5 lg:mx-0">
          {firstIncident && (
            <button
              type="button"
              onClick={() => router.push(getAlertTarget(firstIncident))}
              className="flex w-full items-center gap-3 rounded-lg border border-red-200 bg-white px-4 py-3 text-left shadow-xl transition-colors hover:bg-red-50"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <BellRing className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold text-slate-950">
                  {unreadIncidentAlerts.length} indikasi perlu diperiksa
                </span>
                <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-500">
                  Buka kamera dan periksa tanda merah pada rekaman.
                </span>
              </span>
              <span className="text-[10px] font-bold text-blue-600">Tinjau</span>
            </button>
          )}

          {soundBlocked && soundEnabled && (
            <button
              type="button"
              onClick={() => {
                void unlockNotificationSound().then((unlocked) => {
                  setSoundBlocked(!unlocked);
                });
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-[11px] font-bold text-blue-700 shadow-lg"
            >
              <Volume2 className="h-4 w-4" />
              Aktifkan suara notifikasi
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SessionState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#060a13] px-4 text-center text-sm text-slate-300">
      {message}
    </div>
  );
}

function getAlertTarget(alert: Alert) {
  const params = new URLSearchParams();
  if (alert.cameraId) params.set("cameraId", alert.cameraId);
  const logId = alert.metadata?.logId;
  if (typeof logId === "string") params.set("logId", logId);
  params.set("at", alert.timestamp);
  return `/live-view?${params.toString()}`;
}

function wasAlertSounded(alertId: string) {
  try {
    return (
      JSON.parse(sessionStorage.getItem(SOUNDED_ALERTS_KEY) ?? "[]") as string[]
    ).includes(alertId);
  } catch {
    return false;
  }
}

function rememberSoundedAlert(alertId: string) {
  try {
    const current = JSON.parse(
      sessionStorage.getItem(SOUNDED_ALERTS_KEY) ?? "[]",
    ) as string[];
    sessionStorage.setItem(
      SOUNDED_ALERTS_KEY,
      JSON.stringify(
        [alertId, ...current.filter((id) => id !== alertId)].slice(0, 100),
      ),
    );
  } catch {
    // Session storage is optional; the alert still remains visible.
  }
}
