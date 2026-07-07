"use client";

import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileBottomNav } from "./mobile-nav";
import { useAlertStore } from "@/lib/stores/alert-store";
import { getAlerts, subscribeAlerts } from "@/lib/api/alerts";
import { useUiStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const setAlerts = useAlertStore((s) => s.setAlerts);
  const addAlert = useAlertStore((s) => s.addAlert);
  const pathname = usePathname();

  // Load initial alerts and subscribe to new ones
  useEffect(() => {
    getAlerts().then(setAlerts);
    const unsubscribe = subscribeAlerts(addAlert);
    return unsubscribe;
  }, [setAlerts, addAlert]);

  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);

  return (
    <div className="min-h-screen bg-[#060a13]">
      <Sidebar />
      <div
        className={cn(
          "flex flex-col min-h-screen transition-[padding] duration-300",
          isCollapsed ? "lg:pl-20" : "lg:pl-64"
        )}
      >
        {pathname !== "/dashboard" && pathname !== "/live-view" && pathname !== "/rekaman" && pathname !== "/laporan" && <Topbar />}
        <main className="flex-1 p-4 pwa:p-6 pb-20 lg:pb-6">{children}</main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
