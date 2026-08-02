"use client";

import { Bell, CheckCircle2, ShieldAlert } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DashboardNotificationMenuProps {
  alerts: Alert[];
  unreadCount: number;
  onAlertClick: (alert: Alert) => void | Promise<void>;
  onMarkAll: () => void | Promise<void>;
}

export function DashboardNotificationMenu({
  alerts,
  unreadCount,
  onAlertClick,
  onMarkAll,
}: DashboardNotificationMenuProps) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={
          unreadCount > 0
            ? unreadCount + " notifikasi belum dibaca"
            : "Buka notifikasi"
        }
        title="Notifikasi"
        className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white p-0 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-[13px] font-bold text-slate-950">Notifikasi</p>
            <p className="text-[10px] font-medium text-slate-500">
              {unreadCount} belum dibaca
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void onMarkAll()}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-800"
            >
              Tandai semua dibaca
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="flex min-h-36 flex-col items-center justify-center px-6 text-center">
              <CheckCircle2 className="mb-2 h-7 w-7 text-emerald-500" />
              <p className="text-[12px] font-bold text-slate-800">
                Tidak ada notifikasi baru
              </p>
              <p className="mt-1 text-[10px] font-medium text-slate-500">
                Notifikasi aplikasi akan muncul di sini.
              </p>
            </div>
          ) : (
            alerts.slice(0, 6).map((alert) => (
              <button
                key={alert.id}
                type="button"
                onClick={() => void onAlertClick(alert)}
                className={cn(
                  "flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50",
                  !alert.isRead && "bg-blue-50/60",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
                    alert.type === "bullying_detected"
                      ? "bg-red-100 text-red-600"
                      : "bg-blue-100 text-blue-600",
                  )}
                >
                  {alert.type === "bullying_detected" ? (
                    <ShieldAlert className="h-4 w-4" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[11px] font-bold text-slate-900">
                      {alert.title}
                    </span>
                    {!alert.isRead && (
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600" />
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[10px] font-medium leading-relaxed text-slate-500">
                    {alert.message}
                  </span>
                  <span className="mt-1 block text-[9px] font-semibold text-slate-400">
                    {formatAlertDate(alert.timestamp)}, {formatAlertTime(alert.timestamp)} WIB
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatAlertDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function formatAlertTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}
