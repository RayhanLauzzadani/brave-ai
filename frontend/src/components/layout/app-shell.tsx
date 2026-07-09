"use client";

import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileBottomNav } from "./mobile-nav";
import { useAlertStore } from "@/lib/stores/alert-store";
import { getAlerts, subscribeAlerts } from "@/lib/api/alerts";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setAlerts = useAlertStore((s) => s.setAlerts);
  const addAlert = useAlertStore((s) => s.addAlert);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const pathname = usePathname();
  const router = useRouter();
  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);

  useEffect(() => {
    if (!hasHydrated || isAuthenticated) return;

    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [hasHydrated, isAuthenticated, pathname, router]);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return;

    getAlerts().then(setAlerts).catch(() => undefined);
    const unsubscribe = subscribeAlerts(addAlert);
    return unsubscribe;
  }, [hasHydrated, isAuthenticated, setAlerts, addAlert]);

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060a13] px-4 text-center text-sm text-slate-300">
        Memuat sesi...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#060a13] px-4 text-center text-sm text-slate-300">
        Mengalihkan ke login...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060a13]">
      <Sidebar />
      <div
        className={cn(
          "flex flex-col min-h-screen transition-[padding] duration-300",
          isCollapsed ? "lg:pl-20" : "lg:pl-64"
        )}
      >
        {pathname !== "/dashboard" &&
          pathname !== "/live-view" &&
          pathname !== "/rekaman" &&
          pathname !== "/laporan" &&
          pathname !== "/settings" && <Topbar />}
        <main className="flex-1 p-4 pwa:p-6 pb-20 lg:pb-6">{children}</main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
