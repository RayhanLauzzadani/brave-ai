"use client";

import { usePathname } from "next/navigation";
import { Bell, Search, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { MobileSidebar } from "@/components/layout/mobile-nav";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/live-view": "Live View",
  "/recording-view": "Recordings",
  "/bullying-log": "Bullying Log",
  "/settings": "Settings",
};

export function Topbar() {
  const pathname = usePathname();
  const unreadCount = useAlertStore((s) => s.unreadCount);
  const user = useAuthStore((s) => s.user);
  const title = pageTitles[pathname] || "BRAVE AI";

  return (
    <header className="sticky top-0 z-30 flex items-center h-16 px-4 lg:px-6 border-b border-white/[0.06] bg-[#060a13]/80 backdrop-blur-xl">
      {/* Mobile menu */}
      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden mr-2 text-slate-400 hover:text-white"
            />
          }
        >
          <Menu className="w-5 h-5" />
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-[#064eb7] border-white/[0.06] text-white"
        >
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <MobileSidebar />
        </SheetContent>
      </Sheet>

      {/* Page title */}
      <h2 className="text-base font-semibold text-white">{title}</h2>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2">
        {/* Search */}
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-400 hover:text-white hidden sm:flex"
        >
          <Search className="w-[18px] h-[18px]" />
        </Button>

        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="relative text-slate-400 hover:text-white"
        >
          <Bell className="w-[18px] h-[18px]" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] font-bold flex items-center justify-center rounded-full"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>

        {/* User avatar */}
        <Avatar className="h-8 w-8 border border-white/10">
          <AvatarFallback className="bg-gradient-to-br from-blue-600 to-cyan-500 text-white text-xs font-bold">
            {user?.name?.charAt(0) || "A"}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
