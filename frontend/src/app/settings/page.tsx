"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  Info,
  MoreVertical,
  Share2,
  Smartphone,
  Volume2,
  VolumeX,
} from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { unlockNotificationSound } from "@/lib/notification-sound";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useNotificationPreferencesStore } from "@/lib/stores/notification-preferences-store";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallGuide = "android" | "ios";

const installGuides: Record<InstallGuide, { title: string; helper: string; steps: string[] }> = {
  android: {
    title: "Android / Chrome",
    helper: "Biasanya tombol install bisa muncul langsung dari browser.",
    steps: [
      "Buka BRAVE AI lewat Chrome Android.",
      "Tekan tombol Install Aplikasi jika muncul.",
      "Kalau belum muncul, buka menu tiga titik di kanan atas.",
      "Pilih Install app atau Tambahkan ke layar utama, lalu tekan Install.",
    ],
  },
  ios: {
    title: "iPhone / iOS",
    helper: "Di iPhone, install PWA dilakukan lewat Safari.",
    steps: [
      "Buka BRAVE AI lewat Safari, bukan browser lain.",
      "Tekan tombol Share di bagian bawah Safari.",
      "Pilih Add to Home Screen atau Tambahkan ke Layar Utama.",
      "Tekan Add atau Tambah, lalu buka BRAVE AI dari homescreen.",
    ],
  },
};

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const soundEnabled = useNotificationPreferencesStore(
    (state) => state.soundEnabled,
  );
  const setSoundEnabled = useNotificationPreferencesStore(
    (state) => state.setSoundEnabled,
  );
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [activeGuide, setActiveGuide] = useState<InstallGuide>("android");
  const [installMessage, setInstallMessage] = useState("Android bisa memakai tombol install. iPhone pakai Share dari Safari.");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const checkStandalone = () => {
      const standaloneNavigator = "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      setIsStandalone(mediaQuery.matches || standaloneNavigator);
    };

    const userAgent = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent)) {
      window.setTimeout(() => {
        setActiveGuide("ios");
        setInstallMessage("Untuk iPhone, buka dari Safari lalu gunakan Share > Add to Home Screen.");
      }, 0);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setActiveGuide("android");
      setInstallMessage("Prompt install tersedia. Klik Install Aplikasi untuk memasang BRAVE AI.");
    };

    checkStandalone();
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    mediaQuery.addEventListener("change", checkStandalone);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      mediaQuery.removeEventListener("change", checkStandalone);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isStandalone) {
      setInstallMessage("BRAVE AI sudah berjalan sebagai aplikasi PWA di perangkat ini.");
      return;
    }

    if (!deferredPrompt) {
      setInstallMessage("Prompt install belum muncul otomatis. Ikuti panduan sesuai perangkat di bawah.");
      return;
    }

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setInstallMessage(
      outcome === "accepted"
        ? "Instalasi diterima. BRAVE AI akan tersedia dari homescreen atau launcher."
        : "Instalasi dibatalkan. Kamu masih bisa memasangnya nanti dari menu browser."
    );
  };

  const guide = installGuides[activeGuide];
  const buttonLabel = isStandalone ? "Sudah Terpasang" : deferredPrompt ? "Install Aplikasi" : "Lihat Panduan Install";

  const toggleSound = async () => {
    const nextEnabled = !soundEnabled;
    if (nextEnabled) {
      await unlockNotificationSound().catch(() => false);
    }
    setSoundEnabled(nextEnabled);
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] -m-4 p-4 pb-24 font-sans text-slate-900 pwa:-m-6 pwa:p-6 pwa:pb-24 lg:pb-6">
      <div className="mx-auto max-w-xl">
        <section className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm pwa:p-5 lg:p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-[#064eb7]">
              <Download className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[17px] font-black tracking-tight text-[#1e293b] pwa:text-[18px]">Aplikasi PWA</h1>
              <p className="mt-1 text-[12px] font-medium leading-relaxed text-slate-500 pwa:text-[13px]">
                Pasang BRAVE AI ke homescreen supaya lebih cepat dibuka dari HP.
              </p>
            </div>
          </div>

          <div className={cn("rounded-2xl border px-4 py-3", isStandalone ? "border-emerald-100 bg-emerald-50" : "border-blue-100 bg-blue-50")}>
            <div className="mb-1 flex items-center gap-2">
              {isStandalone ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Info className="h-4 w-4 text-[#064eb7]" />}
              <p className={cn("text-[12px] font-black", isStandalone ? "text-emerald-700" : "text-[#064eb7]")}>{isStandalone ? "PWA Aktif" : "Panduan Install"}</p>
            </div>
            <p className="text-[12px] font-medium leading-relaxed text-slate-600">{installMessage}</p>
          </div>

          <button
            onClick={handleInstallClick}
            disabled={isStandalone}
            className={cn(
              "mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-black transition-colors shadow-sm",
              isStandalone
                ? "cursor-not-allowed border border-emerald-100 bg-emerald-50 text-emerald-700"
                : "bg-[#0e59f2] text-white hover:bg-blue-700"
            )}
          >
            {isStandalone ? <CheckCircle2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {buttonLabel}
          </button>

          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setActiveGuide("android")}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded-lg text-[12px] font-black transition-colors",
                  activeGuide === "android" ? "bg-[#0e59f2] text-white" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <Smartphone className="h-3.5 w-3.5" /> Android
              </button>
              <button
                type="button"
                onClick={() => setActiveGuide("ios")}
                className={cn(
                  "flex h-9 items-center justify-center gap-2 rounded-lg text-[12px] font-black transition-colors",
                  activeGuide === "ios" ? "bg-[#0e59f2] text-white" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <Share2 className="h-3.5 w-3.5" /> iOS
              </button>
            </div>

            <div className="mt-3 rounded-xl bg-white px-3 py-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-black text-[#1e293b]">{guide.title}</h2>
                  <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-slate-500">{guide.helper}</p>
                </div>
                {activeGuide === "android" ? <MoreVertical className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" /> : <Share2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />}
              </div>

              <ol className="space-y-2">
                {guide.steps.map((step, index) => (
                  <li key={step} className="flex gap-2 text-[12px] font-medium leading-relaxed text-slate-600">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-black text-[#064eb7]">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm pwa:p-5 lg:p-6">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-black text-slate-900">
                {user?.name ?? "Pengguna BRAVE AI"}
              </h2>
              <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                {user?.role === "viewer" ? "Guru BK" : "Admin Sekolah"} - {user?.email}
              </p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black text-blue-700">
              {user?.role === "viewer" ? "Viewer" : "Admin"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void toggleSound()}
            className="mt-4 flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-black text-slate-900">Suara Notifikasi</span>
                <span className="mt-0.5 block text-[10px] font-medium text-slate-500">
                  Bunyi saat indikasi baru masuk ketika aplikasi terbuka.
                </span>
              </span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 flex-shrink-0 rounded-full transition-colors",
                soundEnabled ? "bg-blue-600" : "bg-slate-300",
              )}
              aria-hidden="true"
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                  soundEnabled ? "translate-x-[22px]" : "translate-x-0.5",
                )}
              />
            </span>
          </button>

          <LogoutButton
            label="Keluar dari Akun"
            className="mt-4 h-11 w-full rounded-xl border border-red-200 bg-red-50 text-[12px] font-black text-red-700 hover:bg-red-100"
          />
        </section>
      </div>
    </div>
  );
}
