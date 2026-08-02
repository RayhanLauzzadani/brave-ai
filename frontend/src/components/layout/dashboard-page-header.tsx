"use client";

import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { DashboardNotificationMenu } from "@/components/layout/dashboard-notification-menu";
import { MobileSidebar } from "@/components/layout/mobile-nav";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { markAlertRead, markAllAlertsRead } from "@/lib/api/alerts";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useUiStore } from "@/lib/stores/ui-store";
import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DashboardPageHeaderProps {
  title: string;
  description: string;
  onAlertClick?: (alert: Alert) => void | Promise<void>;
  desktopStatus?: ReactNode;
}

export function DashboardPageHeader({
  title,
  description,
  onAlertClick,
  desktopStatus,
}: DashboardPageHeaderProps) {
  const router = useRouter();
  const alerts = useAlertStore((state) => state.alerts);
  const unreadCount = useAlertStore((state) => state.unreadCount);
  const storeMarkRead = useAlertStore((state) => state.markRead);
  const storeMarkAllRead = useAlertStore((state) => state.markAllRead);
  const isCollapsed = useUiStore((state) => state.isSidebarCollapsed);

  const handleAlertClick = async (alert: Alert) => {
    if (!alert.isRead) {
      storeMarkRead(alert.id);
      void markAlertRead(alert.id).catch(() => undefined);
    }

    if (onAlertClick) {
      await onAlertClick(alert);
      return;
    }

    const logId =
      typeof alert.metadata?.logId === "string"
        ? alert.metadata.logId
        : null;
    const params = new URLSearchParams();
    if (alert.cameraId) params.set("cameraId", alert.cameraId);
    if (logId) params.set("logId", logId);
    params.set("at", alert.timestamp);
    router.push("/live-view?" + params.toString());
  };

  const handleMarkAllAlerts = async () => {
    storeMarkAllRead();
    await markAllAlertsRead().catch(() => undefined);
  };

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 -mx-4 -mt-4 mb-5 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-md pwa:-mx-6 pwa:-mt-6 pwa:px-6 lg:fixed lg:right-0 lg:z-40 lg:mx-0 lg:mt-0 lg:mb-0 lg:h-16 lg:bg-white lg:px-8 lg:py-0 lg:backdrop-blur-none lg:transition-[left] lg:duration-300",
          isCollapsed ? "lg:left-20" : "lg:left-64",
        )}
      >
        <div className="hidden pwa:flex lg:hidden">
          <Sheet>
            <SheetTrigger
              render={
                <button
                  type="button"
                  aria-label="Buka navigasi"
                  title="Buka navigasi"
                  className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100"
                />
              }
            >
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 border-white/[0.06] bg-[#064eb7] p-0 text-white"
            >
              <SheetTitle className="sr-only">Navigasi BRAVE AI</SheetTitle>
              <MobileSidebar />
            </SheetContent>
          </Sheet>
        </div>

        <div className="min-w-0 flex-1 pwa:ml-3 lg:ml-0">
          <h1 className="truncate text-[18px] font-bold text-slate-950 lg:text-[15px]">
            {title}
          </h1>
          <p className="truncate text-[11px] font-medium text-slate-500">
            {description}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {desktopStatus && (
            <div className="hidden lg:block">{desktopStatus}</div>
          )}
          <DashboardNotificationMenu
            alerts={alerts}
            unreadCount={unreadCount}
            onAlertClick={handleAlertClick}
            onMarkAll={handleMarkAllAlerts}
          />
        </div>
      </header>

      <div className="hidden h-16 lg:block" />
    </>
  );
}
