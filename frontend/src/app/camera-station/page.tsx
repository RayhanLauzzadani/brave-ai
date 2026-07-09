"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MonitorUp,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Video,
  Wifi,
  WifiOff,
} from "lucide-react";
import { createCamera, getCameras, updateCameraSource } from "@/lib/api/cameras";
import { useAuthStore } from "@/lib/stores/auth-store";
import type { Camera as CameraType } from "@/lib/types";
import {
  buildGatewayHlsUrl,
  buildGatewayWebRtcPublisherUrl,
  buildRaspberryPiInstallCommand,
  getDevicePublisherMediaPath,
  normalizeMediaPath,
} from "@/lib/media-gateway";
import { cn } from "@/lib/utils";

type StationStatus = "idle" | "ready" | "publishing" | "online" | "error";
type HlsStatus = "idle" | "checking" | "online" | "waiting" | "error";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export default function CameraStationPage() {
  const router = useRouter();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [mediaPathInput, setMediaPathInput] = useState("");
  const [newCameraName, setNewCameraName] = useState("Webcam Station");
  const [newCameraLocation, setNewCameraLocation] = useState("Ruang Pengawas");
  const [isLoading, setIsLoading] = useState(true);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCopyingPiCommand, setIsCopyingPiCommand] = useState(false);
  const [stationStatus, setStationStatus] = useState<StationStatus>("idle");
  const [hlsStatus, setHlsStatus] = useState<HlsStatus>("idle");
  const [message, setMessage] = useState("");
  const [publisherUrl, setPublisherUrl] = useState("");
  const [hlsUrl, setHlsUrl] = useState("");
  const [iframeKey, setIframeKey] = useState(0);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) ?? cameras[0] ?? null,
    [cameras, selectedCameraId]
  );

  const loadCameras = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getCameras();
      setCameras(data);
      const params = new URLSearchParams(window.location.search);
      const queryCameraId = params.get("cameraId");
      setSelectedCameraId((current) => {
        if (queryCameraId && data.some((camera) => camera.id === queryCameraId)) return queryCameraId;
        if (current && data.some((camera) => camera.id === current)) return current;
        return data[0]?.id ?? null;
      });
      setStationStatus(data.length > 0 ? "idle" : "error");
      setMessage(data.length > 0 ? "Pilih kamera station lalu siapkan publisher." : "Belum ada kamera. Buat slot station terlebih dahulu.");
    } catch (error) {
      setStationStatus("error");
      setMessage(error instanceof Error ? error.message : "Kamera belum bisa dimuat.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent("/camera-station")}`);
      return;
    }

    const timeout = window.setTimeout(() => void loadCameras(), 0);
    return () => window.clearTimeout(timeout);
  }, [hasHydrated, isAuthenticated, loadCameras, router]);

  useEffect(() => {
    if (!selectedCamera) return;

    const timeout = window.setTimeout(() => {
      const nextMediaPath = getDevicePublisherMediaPath(selectedCamera);
      setMediaPathInput(nextMediaPath);
      if (selectedCamera.sourceType === "hls" && selectedCamera.mediaPath) {
        const cleanPath = normalizeMediaPath(selectedCamera.mediaPath);
        setPublisherUrl(cleanPath ? buildGatewayWebRtcPublisherUrl(cleanPath) : "");
        setHlsUrl(selectedCamera.liveHlsUrl ?? (cleanPath ? buildGatewayHlsUrl(cleanPath) : ""));
        setStationStatus("ready");
      } else {
        setPublisherUrl("");
        setHlsUrl("");
        setHlsStatus("idle");
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectedCamera]);

  useEffect(() => {
    if (!hlsUrl || stationStatus === "idle") return;

    let cancelled = false;
    const checkHls = async () => {
      setHlsStatus((current) => current === "online" ? "online" : "checking");
      try {
        const response = await fetch(hlsUrl, { cache: "no-store" });
        if (cancelled) return;
        if (response.ok) {
          setHlsStatus("online");
          setStationStatus("online");
          return;
        }
        setHlsStatus("waiting");
      } catch {
        if (!cancelled) setHlsStatus("waiting");
      }
    };

    void checkHls();
    const interval = window.setInterval(() => void checkHls(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hlsUrl, stationStatus]);

  useEffect(() => {
    return () => {
      void wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, []);

  const handleCreateCamera = async () => {
    setIsCreating(true);
    setStationStatus("idle");
    setMessage("");
    try {
      const created = await createCamera({
        name: newCameraName.trim() || "Webcam Station",
        location: newCameraLocation.trim() || "Ruang Pengawas",
        isAiEnabled: true,
        sourceType: "mock",
      });
      setCameras((current) => [created, ...current]);
      setSelectedCameraId(created.id);
      setMediaPathInput(getDevicePublisherMediaPath(created));
      setMessage("Slot station dibuat.");
    } catch (error) {
      setStationStatus("error");
      setMessage(error instanceof Error ? error.message : "Slot station belum bisa dibuat.");
    } finally {
      setIsCreating(false);
    }
  };

  const handlePrepareStation = async () => {
    if (!selectedCamera) return;

    const mediaPath = normalizeMediaPath(mediaPathInput) ?? getDevicePublisherMediaPath(selectedCamera);
    setIsPreparing(true);
    setStationStatus("publishing");
    setHlsStatus("checking");
    setMessage("Menyiapkan station...");

    try {
      const updated = await updateCameraSource(selectedCamera.id, {
        sourceType: "hls",
        streamUrl: null,
        mediaPath,
      });
      setCameras((current) => current.map((camera) => camera.id === updated.id ? updated : camera));
      setSelectedCameraId(updated.id);
      setMediaPathInput(mediaPath);
      setPublisherUrl(buildGatewayWebRtcPublisherUrl(mediaPath));
      setHlsUrl(updated.liveHlsUrl ?? buildGatewayHlsUrl(mediaPath));
      setStationStatus("ready");
      setIframeKey((current) => current + 1);
      setMessage("Station siap. Aktifkan publisher kamera di panel utama.");
    } catch (error) {
      setStationStatus("error");
      setMessage(error instanceof Error ? error.message : "Station belum bisa disiapkan.");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleCopyPiCommand = async () => {
    if (!selectedCamera) return;

    const mediaPath = normalizeMediaPath(mediaPathInput) ?? getDevicePublisherMediaPath(selectedCamera);
    setIsCopyingPiCommand(true);
    setStationStatus("publishing");
    setMessage("Menyiapkan command Raspberry Pi...");

    try {
      const updated = await updateCameraSource(selectedCamera.id, {
        sourceType: "hls",
        streamUrl: null,
        mediaPath,
      });
      setCameras((current) => current.map((camera) => camera.id === updated.id ? updated : camera));
      setSelectedCameraId(updated.id);
      setMediaPathInput(mediaPath);
      setPublisherUrl(buildGatewayWebRtcPublisherUrl(mediaPath));
      setHlsUrl(updated.liveHlsUrl ?? buildGatewayHlsUrl(mediaPath));
      setStationStatus("ready");
      await copyTextToClipboard(buildRaspberryPiInstallCommand(mediaPath));
      setMessage(`Command Raspberry Pi untuk ${mediaPath} sudah disalin.`);
    } catch (error) {
      setStationStatus("error");
      setMessage(error instanceof Error ? error.message : "Command Raspberry Pi belum bisa disalin.");
    } finally {
      setIsCopyingPiCommand(false);
    }
  };
  const handleRequestWakeLock = async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release().catch(() => undefined);
      wakeLockRef.current = null;
      setWakeLockActive(false);
      return;
    }

    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock?.request) {
      setMessage("Browser belum mendukung layar tetap aktif. Matikan sleep/power saving dari sistem perangkat.");
      return;
    }

    try {
      const lock = await nav.wakeLock.request("screen");
      wakeLockRef.current = lock;
      setWakeLockActive(true);
      lock.addEventListener("release", () => {
        wakeLockRef.current = null;
        setWakeLockActive(false);
      });
      setMessage("Layar station dijaga tetap aktif selama tab ini terbuka.");
    } catch {
      setMessage("Wake lock belum diizinkan browser. Pastikan halaman aktif dan HTTPS.");
    }
  };

  if (!hasHydrated || !isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050914] px-4 text-center text-sm font-semibold text-slate-300">
        Memuat Camera Station...
      </main>
    );
  }

  const isSecure = typeof window === "undefined" ? true : window.isSecureContext || window.location.hostname === "localhost";
  const selectedMediaPath = normalizeMediaPath(mediaPathInput);

  return (
    <main className="min-h-screen bg-[#050914] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-4 py-4 pwa:px-5 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/live-view" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition-colors hover:bg-white/10" aria-label="Kembali ke Live Camera">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-black tracking-tight pwa:text-[26px]">Camera Station</h1>
              <p className="truncate text-[12px] font-medium text-slate-400 pwa:text-[13px]">{selectedCamera ? `${selectedCamera.name} · ${selectedCamera.location}` : "Perangkat kamera BRAVE AI"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={stationStatus} hlsStatus={hlsStatus} />
            <button onClick={() => void handleRequestWakeLock()} className={cn("flex h-10 items-center gap-2 rounded-full border px-4 text-[12px] font-bold transition-colors", wakeLockActive ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200" : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10")}>
              <MonitorUp className="h-4 w-4" />
              {wakeLockActive ? "Layar Aktif" : "Jaga Layar"}
            </button>
            <button onClick={() => void loadCameras()} disabled={isLoading} className="flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-[12px] font-bold text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-60">
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              Muat Ulang
            </button>
          </div>
        </header>

        {!isSecure && (
          <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-[13px] font-semibold text-amber-100">
            Akses kamera browser membutuhkan HTTPS. Gunakan domain produksi atau localhost.
          </div>
        )}

        <section className="grid flex-1 gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-h-[58vh] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-black shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0b1220] px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] font-bold text-slate-300">
                <Video className="h-4 w-4 text-blue-300" />
                Publisher Webcam
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hlsUrl && (
                  <a href={hlsUrl} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-bold text-slate-200 transition-colors hover:bg-white/10">
                    <Wifi className="h-3.5 w-3.5" />
                    HLS
                  </a>
                )}
                {publisherUrl && (
                  <a href={publisherUrl} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-bold text-slate-200 transition-colors hover:bg-white/10">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Buka Tab
                  </a>
                )}
              </div>
            </div>

            <div className="relative flex min-h-[460px] flex-1 items-center justify-center bg-[#020617]">
              {publisherUrl ? (
                <iframe
                  key={iframeKey}
                  title="BRAVE AI MediaMTX Publisher"
                  src={publisherUrl}
                  allow="camera; microphone; autoplay; fullscreen; display-capture"
                  className="h-full min-h-[460px] w-full border-0 bg-black"
                />
              ) : (
                <div className="flex max-w-sm flex-col items-center px-6 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-blue-300/20 bg-blue-500/10 text-blue-200">
                    <PlayCircle className="h-8 w-8" />
                  </div>
                  <p className="text-[15px] font-bold text-slate-100">Station belum disiapkan</p>
                  <p className="mt-2 text-[12px] font-medium leading-relaxed text-slate-500">Pilih kamera dan simpan path MediaMTX untuk membuka publisher.</p>
                </div>
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4 shadow-xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-black">Kamera Station</h2>
                {isLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-300" />}
              </div>

              <div className="space-y-2">
                {cameras.map((camera) => {
                  const active = camera.id === selectedCamera?.id;
                  return (
                    <button
                      key={camera.id}
                      onClick={() => setSelectedCameraId(camera.id)}
                      className={cn("flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition-colors", active ? "border-blue-300/30 bg-blue-500/15" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-black text-slate-100">{camera.name}</span>
                        <span className="block truncate text-[11px] font-semibold text-slate-500">{camera.location}</span>
                      </span>
                      {active && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-blue-300" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4 shadow-xl backdrop-blur">
              <h2 className="mb-3 text-[15px] font-black">Konfigurasi</h2>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Path MediaMTX</label>
              <input
                value={mediaPathInput}
                onChange={(event) => setMediaPathInput(event.target.value)}
                placeholder="camera-station-1"
                className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-[13px] font-semibold text-slate-100 outline-none transition focus:border-blue-300/50 focus:ring-4 focus:ring-blue-500/10"
              />
              <div className="mt-3 grid grid-cols-1 gap-2 pwa:grid-cols-3">
                <button onClick={() => void handlePrepareStation()} disabled={!selectedCamera || !selectedMediaPath || isPreparing} className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 text-[13px] font-black text-white shadow-lg shadow-blue-950/30 transition-colors hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400">
                  {isPreparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Siapkan
                </button>
                <button onClick={() => void handleCopyPiCommand()} disabled={!selectedCamera || !selectedMediaPath || isCopyingPiCommand} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-[13px] font-black text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-50">
                  {isCopyingPiCommand ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  Copy Pi
                </button>
                <button onClick={() => setIframeKey((current) => current + 1)} disabled={!publisherUrl} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-[13px] font-black text-slate-200 transition-colors hover:bg-white/10 disabled:opacity-50">
                  <RefreshCw className="h-4 w-4" />
                  Publisher
                </button>
              </div>
              {message && (
                <div className={cn("mt-3 rounded-2xl border px-3 py-2 text-[12px] font-semibold leading-relaxed", stationStatus === "error" ? "border-red-300/20 bg-red-500/10 text-red-100" : "border-blue-300/20 bg-blue-500/10 text-blue-100")}>
                  {message}
                </div>
              )}
            </div>

            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4 shadow-xl backdrop-blur">
              <h2 className="mb-3 text-[15px] font-black">Slot Baru</h2>
              <div className="space-y-2">
                <input
                  value={newCameraName}
                  onChange={(event) => setNewCameraName(event.target.value)}
                  placeholder="Nama kamera"
                  className="h-10 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-[12px] font-semibold text-slate-100 outline-none transition focus:border-blue-300/50 focus:ring-4 focus:ring-blue-500/10"
                />
                <input
                  value={newCameraLocation}
                  onChange={(event) => setNewCameraLocation(event.target.value)}
                  placeholder="Lokasi"
                  className="h-10 w-full rounded-2xl border border-white/10 bg-black/20 px-3 text-[12px] font-semibold text-slate-100 outline-none transition focus:border-blue-300/50 focus:ring-4 focus:ring-blue-500/10"
                />
                <button onClick={() => void handleCreateCamera()} disabled={isCreating} className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-[12px] font-black text-slate-100 transition-colors hover:bg-white/10 disabled:opacity-50">
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Tambah Slot
                </button>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
function StatusPill({ status, hlsStatus }: { status: StationStatus; hlsStatus: HlsStatus }) {
  const state = hlsStatus === "online" ? "online" : status;
  const label = getStatusLabel(state, hlsStatus);
  const active = state === "online" || state === "ready";
  const waiting = state === "publishing" || hlsStatus === "checking" || hlsStatus === "waiting";

  return (
    <div className={cn("flex h-10 items-center gap-2 rounded-full border px-4 text-[12px] font-black", active ? "border-emerald-400/25 bg-emerald-400/15 text-emerald-100" : waiting ? "border-amber-300/25 bg-amber-300/15 text-amber-100" : status === "error" ? "border-red-300/25 bg-red-500/15 text-red-100" : "border-white/10 bg-white/5 text-slate-200")}>
      {active ? <ShieldCheck className="h-4 w-4" /> : status === "error" ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
      {label}
    </div>
  );
}

function getStatusLabel(status: StationStatus | "online", hlsStatus: HlsStatus) {
  if (hlsStatus === "online") return "Live Online";
  if (hlsStatus === "checking") return "Cek Stream";
  if (hlsStatus === "waiting") return "Menunggu HLS";
  if (status === "ready") return "Publisher Siap";
  if (status === "publishing") return "Menyiapkan";
  if (status === "error") return "Butuh Aksi";
  return "Idle";
}