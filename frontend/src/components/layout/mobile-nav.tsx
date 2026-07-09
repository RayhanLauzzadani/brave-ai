"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Home,
  Video,
  Folder,
  FileText,
  Shield,
} from "lucide-react";

const navItems = [
  { href: "/live-view", label: "Live Camera", icon: Video },
  { href: "/rekaman", label: "Rekaman", icon: Folder },
  { href: "/laporan", label: "Laporan", icon: FileText },
];

/** Bottom tab navigation for mobile/PWA */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <div className="pwa:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-50">
      <nav className="border-t border-slate-200/60 bg-white shadow-[0_-4px_24px_-12px_rgba(0,0,0,0.06)] safe-area-bottom pb-safe">
        <div className="flex items-center justify-around h-[64px] px-2">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex flex-col items-center justify-center w-full h-full gap-[4px] pt-1"
              >
                <div
                  className={cn(
                    "flex items-center justify-center w-[48px] h-[32px] rounded-full transition-all duration-200",
                    isActive ? "bg-blue-50/80" : "bg-transparent"
                  )}
                >
                  <item.icon
                    className={cn(
                      "w-[22px] h-[22px] transition-colors duration-200",
                      isActive ? "text-blue-600" : "text-slate-500"
                    )}
                    fill="none"
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                </div>
                <span
                  className={cn(
                    "text-[10px] leading-none transition-colors duration-200",
                    isActive ? "font-semibold text-blue-600" : "font-medium text-slate-500"
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/** Sidebar content for mobile sheet */
export function MobileSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 h-16 border-b border-white/[0.06]">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-white tracking-wide">
            BRAVE AI
          </h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">
            Anti-Bullying
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-4 px-4 py-3 rounded-xl text-[15px] font-medium transition-all duration-200",
                isActive
                  ? "bg-white/15 text-white font-semibold"
                  : "text-white/80 hover:text-white hover:bg-white/10"
              )}
            >
              <item.icon
                className={cn(
                  "w-[22px] h-[22px] flex-shrink-0",
                  isActive ? "text-white" : "text-white/80"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
