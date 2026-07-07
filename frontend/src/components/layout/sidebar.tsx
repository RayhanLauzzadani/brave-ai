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
  CheckCircle2,
  Smartphone,
  Share,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useUiStore } from "@/lib/stores/ui-store";

const navItems = [
  { href: "/live-view", label: "Live Camera", icon: Video },
  { href: "/rekaman", label: "Rekaman", icon: Folder },
  { href: "/laporan", label: "Laporan", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 z-40 border-r border-white/[0.06] bg-[#064eb7] transition-[width] duration-300 ease-in-out",
        isCollapsed ? "lg:w-20" : "lg:w-64"
      )}
    >
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-blue-600 hover:shadow-md transition-all z-50 shadow-sm"
      >
        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      {/* Logo */}
      <div className="flex items-center h-16 border-b border-white/[0.06] overflow-hidden px-5 gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex-shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div
          className={cn(
            "transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap",
            isCollapsed ? "w-0 opacity-0" : "w-36 opacity-100"
          )}
        >
          <h1 className="text-base font-bold text-white tracking-wide">
            BRAVE AI
          </h1>
          <p className="text-[10px] text-blue-200/60 uppercase tracking-widest">
            Anti-Bullying
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex items-center rounded-xl text-[14px] font-medium transition-all duration-300 ease-in-out overflow-hidden whitespace-nowrap h-[46px]",
                isCollapsed 
                  ? "justify-center w-[46px] mx-auto px-0" 
                  : "gap-3.5 px-4 mx-1",
                isActive
                  ? "bg-white/15 text-white font-semibold shadow-sm shadow-black/10"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              )}
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon
                className={cn(
                  "w-[20px] h-[20px] flex-shrink-0 transition-colors duration-200",
                  isActive ? "text-white" : "text-white/70"
                )}
              />
              <span
                className={cn(
                  "transition-all duration-300 ease-in-out overflow-hidden",
                  isCollapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="px-3 pb-5 overflow-hidden">
        {/* Expanded state */}
        <div
          className={cn(
            "space-y-3 transition-all duration-300 ease-in-out",
            isCollapsed ? "opacity-0 scale-95 h-0 pointer-events-none" : "opacity-100 scale-100 h-auto"
          )}
        >
          {/* User Profile */}
          <div className="bg-white/10 rounded-2xl p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-orange-200 flex-shrink-0 overflow-hidden">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix&backgroundColor=ffdfbf" alt="User" className="w-full h-full object-cover" />
            </div>
            <div className="overflow-hidden">
              <p className="text-[11px] text-white/60">Selamat datang,</p>
              <p className="text-[13px] font-semibold text-white truncate">{user?.name || "Budi Santoso"}</p>
              <div className="mt-0.5 inline-block px-2 py-0.5 bg-blue-500/40 rounded-md text-[10px] text-white/90">
                {user?.role === "admin" ? "Admin Sekolah" : "Admin Sekolah"}
              </div>
            </div>
          </div>

          {/* System Status */}
          <div className="bg-white/10 rounded-2xl p-3.5">
            <h3 className="text-[12px] font-semibold text-white/90 mb-1.5">Status Sistem</h3>
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[12px] text-white/90">Online</span>
            </div>
            <p className="text-[10px] text-white/50">Semua sistem berjalan normal</p>
          </div>
        </div>

        {/* Collapsed state */}
        <div
          className={cn(
            "flex flex-col items-center gap-4 transition-all duration-300 ease-in-out",
            isCollapsed ? "opacity-100 scale-100" : "opacity-0 scale-95 h-0 pointer-events-none"
          )}
        >
          <div className="w-9 h-9 rounded-full bg-orange-200 flex-shrink-0 overflow-hidden" title={user?.name || "Budi Santoso"}>
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix&backgroundColor=ffdfbf" alt="User" className="w-full h-full object-cover" />
          </div>
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" title="System Online" />
        </div>
      </div>
    </aside>
  );
}
