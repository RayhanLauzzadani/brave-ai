"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { FileText, Folder, Settings, Shield, Video } from "lucide-react";

const navItems = [
  { href: "/live-view", label: "Live Camera", shortLabel: "Live", icon: Video },
  { href: "/rekaman", label: "Rekaman", shortLabel: "Rekaman", icon: Folder },
  { href: "/laporan", label: "Laporan", shortLabel: "Laporan", icon: FileText },
  { href: "/settings", label: "Pengaturan", shortLabel: "Setelan", icon: Settings },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
      <nav className="safe-area-bottom border-t border-slate-200 bg-white/95 shadow-[0_-10px_30px_-22px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <div className="grid h-[66px] grid-cols-4 px-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className="group flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center outline-none transition-colors focus-visible:ring-4 focus-visible:ring-blue-100"
              >
                <span
                  className={cn(
                    "flex h-8 w-12 items-center justify-center rounded-full transition-all duration-200",
                    isActive ? "bg-blue-50 text-[#064eb7]" : "text-slate-400 group-hover:bg-slate-50 group-hover:text-slate-600"
                  )}
                >
                  <item.icon className="h-[19px] w-[19px]" strokeWidth={isActive ? 2.6 : 2.2} />
                </span>
                <span
                  className={cn(
                    "max-w-full truncate text-[10px] font-bold leading-none tracking-tight",
                    isActive ? "text-[#064eb7]" : "text-slate-500"
                  )}
                >
                  {item.shortLabel}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function MobileSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-[#064eb7] text-white">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-400/95 shadow-sm">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-black tracking-tight">BRAVE AI</h1>
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-100/70">
            Anti-Bullying
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-5">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-12 items-center gap-3 rounded-2xl px-4 text-[14px] font-bold transition-colors outline-none focus-visible:ring-4 focus-visible:ring-white/20",
                isActive
                  ? "bg-white/16 text-white shadow-sm"
                  : "text-blue-50/78 hover:bg-white/10 hover:text-white"
              )}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" strokeWidth={isActive ? 2.6 : 2.2} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-5">
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.14)]" />
            <p className="text-[13px] font-bold text-white">Sistem Online</p>
          </div>
          <p className="text-[11px] font-medium leading-relaxed text-blue-50/70">
            Monitoring kamera dan notifikasi berjalan normal.
          </p>
        </div>
      </div>
    </div>
  );
}
