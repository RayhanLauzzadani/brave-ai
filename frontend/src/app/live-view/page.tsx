"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, Calendar, Signal, Volume2, Pause, VolumeX, Settings, Link2, Save, Smartphone,
  ShieldCheck, CheckCircle2, Camera, Play, MoreVertical, Menu, MapPin, Clock, ShieldAlert, Circle, Maximize, Minimize
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { MobileSidebar } from "@/components/layout/mobile-nav";
import { LiveCameraPlayer } from "@/components/camera/live-camera-player";
import { useRouter } from "next/navigation";
import { getAlerts, subscribeAlerts } from "@/lib/api/alerts";
import { getBullyingLogs } from "@/lib/api/bullying-logs";
import { getCameras, updateCameraSource } from "@/lib/api/cameras";
import { createEvidenceClip, getRecordings } from "@/lib/api/recordings";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useCameraStore } from "@/lib/stores/camera-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";
import type { BullyingLog, Camera as CameraType, CameraSourceType, Recording } from "@/lib/types";
import {
  FALLBACK_ACTIVITIES,
  FALLBACK_CAMERAS,
  cameraStatusLabel,
  formatClock,
  formatDisplayDate,
  formatMobileDate,
  getCameraImage,
  isCameraOnline,
  toActivityItems,
  toQuickRecordingItems,
} from "./live-view-presenters";

export default function LiveViewPage() {
  const router = useRouter();
  const unreadCount = useAlertStore((s) => s.unreadCount);
  const setAlerts = useAlertStore((s) => s.setAlerts);
  const addAlert = useAlertStore((s) => s.addAlert);
  const selectedCameraId = useCameraStore((s) => s.selectedCameraId);
  const setSelectedCameraId = useCameraStore((s) => s.setSelectedCamera);
  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [quality, setQuality] = useState<"HD" | "SD">("HD");
  const [now, setNow] = useState(() => new Date());
  const [cameras, setCameras] = useState<CameraType[]>(FALLBACK_CAMERAS);
  const [logs, setLogs] = useState<BullyingLog[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);

  const [showAllCameras, setShowAllCameras] = useState(false);
  const [localWebcamCameraId, setLocalWebcamCameraId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<CameraSourceType>("mock");
  const [streamUrlInput, setStreamUrlInput] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [isSavingSource, setIsSavingSource] = useState(false);

  const loadLiveData = useCallback(async () => {
    const [cameraResult, logResult, recordingResult, alertResult] =
      await Promise.allSettled([
        getCameras(),
        getBullyingLogs(),
        getRecordings({ hasIncident: true }),
        getAlerts(),
      ]);

    if (cameraResult.status === "fulfilled" && cameraResult.value.length > 0) {
      const nextCameras = cameraResult.value;
      setCameras(nextCameras);
      setSelectedCameraId(
        selectedCameraId && nextCameras.some((camera) => camera.id === selectedCameraId)
          ? selectedCameraId
          : nextCameras[0]?.id ?? null
      );
    }

    if (logResult.status === "fulfilled") {
      setLogs(logResult.value);
    }

    if (recordingResult.status === "fulfilled") {
      setRecordings(recordingResult.value);
    }

    if (alertResult.status === "fulfilled") {
      setAlerts(alertResult.value);
    }
  }, [selectedCameraId, setAlerts, setSelectedCameraId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadLiveData();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadLiveData]);

  useEffect(() => {
    const unsubscribe = subscribeAlerts((alert) => {
      addAlert(alert);
      void loadLiveData();
    });

    return unsubscribe;
  }, [addAlert, loadLiveData]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const cameraItems = useMemo(
    () =>
      cameras.map((camera, index) => ({
        ...camera,
        image: getCameraImage(camera, index),
      })),
    [cameras]
  );

  const selectedCamera = useMemo(
    () =>
      cameraItems.find((camera) => camera.id === selectedCameraId) ??
      cameraItems[0],
    [cameraItems, selectedCameraId]
  );

  const selectedCameraIndex = Math.max(
    0,
    cameraItems.findIndex((camera) => camera.id === selectedCamera?.id)
  );
  const selectedCameraImage = getCameraImage(selectedCamera, selectedCameraIndex);
  const selectedCameraOnline = isCameraOnline(selectedCamera);
  const localWebcamActive = localWebcamCameraId === selectedCamera?.id;
  const playerCanInteract = selectedCameraOnline || localWebcamActive;
  const selectedCameraLogs = logs.filter(
    (log) => log.cameraId === selectedCamera?.id
  );
  const displayLogs = selectedCameraLogs.length > 0 ? selectedCameraLogs : logs;
  const activityItems = toActivityItems(displayLogs, FALLBACK_ACTIVITIES);
  const quickRecordingItems = toQuickRecordingItems(recordings);
  const activeRecording = recordings.find(
    (recording) => recording.cameraId === selectedCamera?.id
  );
  const latestLog = displayLogs[0];
  const visibleCameraItems = showAllCameras
    ? cameraItems
    : cameraItems.slice(0, 4);
  const playerIsPlaying = playerCanInteract && isPlaying;


  const handleSnapshot = () => {
    if (!selectedCamera || !playerCanInteract) return;

    const media = videoContainerRef.current?.querySelector("video, img") as HTMLVideoElement | HTMLImageElement | null;
    const liveCanvas = document.createElement("canvas");
    const liveContext = liveCanvas.getContext("2d");

    if (media && liveContext) {
      try {
        if (media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0) {
          liveCanvas.width = media.videoWidth;
          liveCanvas.height = media.videoHeight;
          liveContext.drawImage(media, 0, 0, liveCanvas.width, liveCanvas.height);
          downloadSnapshot(liveCanvas, selectedCamera.id);
          return;
        }

        if (media instanceof HTMLImageElement && media.complete && media.naturalWidth > 0) {
          liveCanvas.width = media.naturalWidth;
          liveCanvas.height = media.naturalHeight;
          liveContext.drawImage(media, 0, 0, liveCanvas.width, liveCanvas.height);
          downloadSnapshot(liveCanvas, selectedCamera.id);
          return;
        }
      } catch {
        // Cross-origin image streams can taint canvas; fallback keeps snapshot available.
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#1d4ed8";
    context.fillRect(0, 0, canvas.width, 12);
    context.fillStyle = "#ffffff";
    context.font = "bold 44px Arial";
    context.fillText(selectedCamera.name, 64, 100);
    context.font = "26px Arial";
    context.fillText(`${selectedCamera.location} - ${formatDisplayDate(now)} ${formatClock(now)} WIB`, 64, 146);
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.fillRect(64, 210, 1152, 360);
    context.fillStyle = "#bfdbfe";
    context.font = "bold 34px Arial";
    context.fillText("BRAVE AI CCTV SNAPSHOT", 64, 650);

    downloadSnapshot(canvas, selectedCamera.id);
  };

  const handleSaveRecording = async () => {
    if (!selectedCamera) return;
    if (!selectedCameraOnline) {
      window.alert("Kamera sedang offline, rekaman belum bisa disimpan.");
      return;
    }
    if (!activeRecording) {
      window.alert("Belum ada rekaman insiden untuk kamera ini.");
      return;
    }

    const eventDate = new Date(latestLog?.timestamp ?? Date.now());
    const startTime = new Date(eventDate.getTime() - 60_000).toISOString();
    const endTime = new Date(eventDate.getTime() + 60_000).toISOString();

    try {
      const clip = await createEvidenceClip(activeRecording.id, {
        cameraId: selectedCamera.id,
        startTime,
        endTime,
        reason: "manual_live_view_save",
      });
      window.alert(`Clip bukti ${clip.id} masuk antrean export.`);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Rekaman belum bisa disimpan."
      );
    }
  };

  const handleToggleLocalWebcam = () => {
    if (!selectedCamera) return;
    setSourceMessage("");
    setLocalWebcamCameraId((current) => current === selectedCamera.id ? null : selectedCamera.id);
  };

  const handleSaveCameraSource = async () => {
    if (!selectedCamera) return;
    setIsSavingSource(true);
    setSourceMessage("");

    try {
      const updated = await updateCameraSource(selectedCamera.id, {
        sourceType,
        streamUrl: streamUrlInput.trim() || null,
      });
      setCameras((current) => current.map((camera) => camera.id === updated.id ? updated : camera));
      setLocalWebcamCameraId(null);
      setSourceMessage(getSourceSaveMessage(updated.sourceType));
    } catch (error) {
      setSourceMessage(error instanceof Error ? error.message : "Sumber kamera belum bisa disimpan.");
    } finally {
      setIsSavingSource(false);
    }
  };
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await videoContainerRef.current?.requestFullscreen().catch(err => {
        console.error("Error attempting to enable full-screen mode:", err.message);
      });
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 -m-4 p-4 pwa:-m-6 pwa:p-6 pb-20 pwa:pb-6">
      {/* Mobile Top Bar */}
      <div className="flex lg:hidden items-center justify-between mb-6">
        {/* Hamburger Menu (only visible on tablet, 501px - 1023px) */}
        <div className="hidden pwa:flex items-center">
          <Sheet>
            <SheetTrigger render={<button className="p-2 -ml-2 rounded-lg hover:bg-slate-200 transition-colors" />}>
              <Menu className="w-6 h-6 text-[#1e293b]" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-[#064eb7] border-white/[0.06] text-white">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <MobileSidebar />
            </SheetContent>
          </Sheet>
        </div>
        
        {/* Spacer for mobile where hamburger is hidden */}
        <div className="pwa:hidden flex-1"></div>

        <button onClick={() => router.push("/laporan")} className="relative p-2 rounded-full hover:bg-slate-200 transition-colors flex-shrink-0">
          <Bell className="w-6 h-6 text-[#1e293b]" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-slate-50">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Desktop Header (fixed, sidebar-aware â€” only visible at lg when sidebar exists) */}
        <div className={cn(
          "hidden lg:flex fixed top-0 right-0 z-40 bg-white items-center justify-between h-16 px-6 lg:px-8 border-b border-slate-100 shadow-sm transition-[left] duration-300",
          isCollapsed ? "lg:left-20" : "lg:left-64"
        )}>
          <div>
            <h2 className="text-[15px] font-bold text-[#0f172a]">Live Camera</h2>
            <p className="text-[11px] font-desc text-slate-500 -mt-0.5">Pantau kamera sekolah secara real-time</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/laporan")} className="relative flex items-center justify-center w-9 h-9 rounded-full bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <Bell className="w-[18px] h-[18px]" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Spacer for fixed header on desktop (only when sidebar/header visible at lg) */}
        <div className="hidden lg:block h-10" />

        {/* Mobile & Tablet Title (hidden at lg where fixed header takes over) */}
        <div className="lg:hidden mb-4">
          <h1 className="text-[20px] pwa:text-[22px] font-bold text-[#0f172a] tracking-tight">Live Camera</h1>
          <p className="text-[11px] pwa:text-[12px] font-desc text-slate-500 mt-1 leading-relaxed pr-2">
            Pantau kamera sekolah secara real-time.
          </p>
        </div>

        {/* Top Grid: Video Player (Left) & Detail Kamera (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pwa:gap-5 lg:gap-6">
          {/* Main Camera Player */}
          <div className="lg:col-span-9 bg-white rounded-[20px] pwa:rounded-[24px] border border-slate-100 shadow-sm p-3 pwa:p-4 lg:p-5 flex flex-col">
            <div className="flex flex-col pwa:flex-row pwa:items-center justify-between gap-2 pwa:gap-0 mb-3 pwa:mb-4 lg:mb-5">
              <div className="flex items-center gap-3 overflow-hidden">
                <h2 className="text-[17px] pwa:text-[18px] md:text-[20px] lg:text-[22px] font-bold text-[#0f172a] tracking-tight truncate">{selectedCamera?.name ?? "Belum ada kamera"}</h2>
              </div>
              
              <div className="flex items-center justify-between pwa:justify-end gap-2 pwa:gap-3 lg:gap-5 flex-shrink-0">
                {/* Date & Time Pill with Live Badge */}
                <div className="flex items-center bg-slate-50 border border-slate-200/60 p-1 pr-2.5 pwa:p-1 pwa:pr-3 lg:p-1.5 lg:pr-4 rounded-full shadow-sm">
                  {/* Live Badge */}
                  <div className="flex items-center gap-1 pwa:gap-1.5 px-2 pwa:px-2 lg:px-3 py-1 bg-red-50 rounded-full border border-red-100/50 mr-1.5 pwa:mr-2 lg:mr-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[9px] pwa:text-[10px] lg:text-[11px] font-bold text-red-600 tracking-wider uppercase">Live</span>
                  </div>
                  
                  {/* Date & Time */}
                  <div className="flex items-center gap-1.5 pwa:gap-2 lg:gap-3">
                    <div className="flex items-center gap-1 pwa:gap-1.5">
                      <Calendar className="w-3 h-3 pwa:w-3.5 pwa:h-3.5 text-slate-400" />
                      <span className="text-[10px] pwa:text-[11px] lg:text-[12px] font-medium text-slate-600 hidden pwa:block">{formatDisplayDate(now)}</span>
                      <span className="text-[10px] font-medium text-slate-600 pwa:hidden">{formatMobileDate(now)}</span>
                    </div>
                    <div className="w-1 h-1 rounded-full bg-slate-300" />
                    <div className="flex items-center gap-1 pwa:gap-1.5">
                      <Clock className="w-3 h-3 pwa:w-3.5 pwa:h-3.5 text-slate-400" />
                      <span className="text-[10px] pwa:text-[11px] lg:text-[13px] font-bold text-slate-800 font-mono tracking-tight">{formatClock(now)}</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={toggleFullscreen}
                  className="hidden pwa:flex p-1.5 text-slate-400 hover:text-[#0f172a] hover:bg-slate-100 rounded-lg transition-colors"
                >
                  {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
                <button onClick={() => setQuality((value) => value === "HD" ? "SD" : "HD")} disabled={!playerCanInteract} className="pwa:hidden p-1.5 text-slate-400 hover:text-[#0f172a] hover:bg-slate-100 rounded-lg transition-colors">
                  <Settings className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div 
              ref={videoContainerRef}
              className="relative w-full aspect-[4/3] pwa:aspect-[16/10] lg:aspect-[21/9] bg-[#1e293b] rounded-[14px] pwa:rounded-[16px] lg:rounded-[20px] overflow-hidden group"
            >
              <LiveCameraPlayer
                camera={selectedCamera}
                fallbackImage={selectedCameraImage}
                isOnline={selectedCameraOnline}
                isPlaying={playerIsPlaying}
                isMuted={isMuted}
                useLocalWebcam={localWebcamActive}
              />
              
              {/* Overlays */}
              <div className="absolute top-3 left-3 pwa:top-4 pwa:left-4">
                <div className="bg-[#1c1c1c]/80 backdrop-blur-md px-2.5 py-1.5 pwa:px-3 pwa:py-1.5 rounded-lg flex items-center gap-1.5 pwa:gap-2">
                  <span className="text-white text-[11px] pwa:text-[12px] font-bold">{quality}</span>
                  <Signal className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 text-emerald-500" />
                </div>
              </div>

              <div className="absolute top-3 right-3 pwa:top-4 pwa:right-4">
                <button onClick={() => setIsMuted((value) => !value)} disabled={!playerCanInteract} className="w-9 h-9 pwa:w-10 pwa:h-10 rounded-lg bg-[#1c1c1c]/80 backdrop-blur-md flex items-center justify-center hover:bg-[#1c1c1c] transition-colors">
                  {isMuted ? <VolumeX className="w-4 h-4 pwa:w-5 pwa:h-5 text-white" /> : <Volume2 className="w-4 h-4 pwa:w-5 pwa:h-5 text-white" />}
                </button>
              </div>

              {/* Controls Bar */}
              <div className="absolute bottom-3 left-3 right-3 pwa:bottom-4 pwa:left-4 pwa:right-4 bg-[#1a1a1a] rounded-[12px] pwa:rounded-[16px] px-3.5 py-2.5 pwa:px-4 pwa:py-3 flex items-center gap-3 pwa:gap-5">
                <button onClick={() => setIsPlaying((value) => !value)} disabled={!playerCanInteract} className="text-white hover:text-blue-400 transition-colors">
                  {playerIsPlaying ? <Pause className="w-4 h-4 pwa:w-5 pwa:h-5 fill-current" /> : <Play className="w-4 h-4 pwa:w-5 pwa:h-5 fill-current" />}
                </button>
                <button onClick={() => setIsMuted((value) => !value)} disabled={!playerCanInteract} className="text-white hover:text-blue-400 transition-colors">
                  {isMuted ? <VolumeX className="w-4 h-4 pwa:w-5 pwa:h-5" /> : <Volume2 className="w-4 h-4 pwa:w-5 pwa:h-5" />}
                </button>
                <button onClick={() => setQuality((value) => value === "HD" ? "SD" : "HD")} disabled={!playerCanInteract} className="px-1.5 py-0.5 border border-white/30 rounded font-bold text-white text-[10px] pwa:text-[11px]">{quality}</button>
                
                {/* Timeline */}
                <div className="flex-1 flex items-center gap-2 px-1">
                  <div className="h-1 pwa:h-1.5 flex-1 bg-white/20 rounded-full relative cursor-pointer">
                    <div className="absolute left-0 top-0 bottom-0 w-[45%] bg-blue-600 rounded-full"></div>
                    <div className="absolute left-[45%] top-1/2 -translate-y-1/2 w-2.5 h-2.5 pwa:w-3 pwa:h-3 bg-white pwa:bg-blue-600 rounded-full shadow-md"></div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pwa:gap-2">
                  <div className="w-1.5 h-1.5 pwa:w-2 pwa:h-2 rounded-full bg-blue-500 pwa:bg-red-500" />
                  <span className="text-[11px] pwa:text-[12px] font-bold text-white tracking-wider">LIVE</span>
                </div>
                <button onClick={() => setQuality((value) => value === "HD" ? "SD" : "HD")} disabled={!playerCanInteract} className="hidden pwa:block text-white hover:text-blue-400 transition-colors ml-1">
                  <Settings className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Detail Kamera (dipindah ke bawah video) */}
            <div className="mt-4 pwa:mt-5 lg:mt-6 pt-4 pwa:pt-5 lg:pt-6 border-t border-slate-100 flex flex-col lg:flex-row gap-4 pwa:gap-5 lg:gap-6 justify-between lg:items-center">
              <div className="grid grid-cols-2 lg:flex lg:flex-row lg:justify-between gap-y-3 pwa:gap-y-4 gap-x-2 pwa:gap-4 w-full lg:flex-1 lg:pr-4">
                <div>
                  <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5 lg:whitespace-nowrap">Status</p>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 pwa:w-[18px] pwa:h-[18px] text-emerald-500 flex-shrink-0" />
                    <span className="text-[12px] pwa:text-[14px] font-semibold text-[#1e293b] lg:whitespace-nowrap">{cameraStatusLabel(selectedCamera)}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5 lg:whitespace-nowrap">Lokasi</p>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 pwa:w-[18px] pwa:h-[18px] text-slate-400 flex-shrink-0" />
                    <span className="text-[12px] pwa:text-[14px] font-semibold text-[#1e293b] lg:whitespace-nowrap">{selectedCamera?.location ?? "-"}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5 lg:whitespace-nowrap">Terakhir Aktif</p>
                  <div className="flex items-start pwa:items-center gap-1.5">
                    <Clock className="w-4 h-4 pwa:w-[18px] pwa:h-[18px] text-slate-400 flex-shrink-0 mt-0.5 pwa:mt-0" />
                    <span className="text-[12px] pwa:text-[14px] font-semibold text-[#1e293b] lg:whitespace-nowrap leading-snug">
                      {formatDisplayDate(selectedCamera?.lastActive)}<br className="lg:hidden" /> {formatClock(selectedCamera?.lastActive)} WIB
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5 lg:whitespace-nowrap">Penyimpanan</p>
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 pwa:w-[18px] pwa:h-[18px] text-emerald-500 flex-shrink-0" />
                    <span className="text-[12px] pwa:text-[14px] font-semibold text-[#1e293b] lg:whitespace-nowrap">Aman</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pwa:gap-3 w-full lg:w-auto mt-2 lg:mt-0 flex-shrink-0">
                <button onClick={() => void handleSaveRecording()} disabled={!selectedCameraOnline} className="flex-1 lg:flex-none lg:min-w-[150px] flex items-center justify-center gap-1.5 pwa:gap-2 px-2 pwa:px-4 lg:px-5 py-2.5 pwa:py-2.5 lg:py-3 bg-[#fb3b6e] hover:bg-[#eb2a5d] text-white rounded-xl font-bold text-[11px] pwa:text-[12px] lg:text-[14px] transition-colors shadow-sm lg:shadow-pink-500/20 whitespace-nowrap">
                  <span className="flex w-3.5 h-3.5 pwa:w-4 pwa:h-4 lg:w-[18px] lg:h-[18px] rounded-full border-[1.5px] border-white items-center justify-center flex-shrink-0">
                    <span className="w-1.5 h-1.5 pwa:w-1.5 pwa:h-1.5 lg:w-2 lg:h-2 bg-white rounded-full"></span>
                  </span>
                  Simpan Rekaman
                </button>
                <button onClick={handleSnapshot} disabled={!playerCanInteract} className="flex-1 lg:flex-none lg:min-w-[130px] flex items-center justify-center gap-1.5 pwa:gap-2 px-2 pwa:px-4 lg:px-5 py-2.5 pwa:py-2.5 lg:py-3 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-100 rounded-xl font-bold text-[11px] pwa:text-[12px] lg:text-[14px] transition-colors whitespace-nowrap">
                  <Camera className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 lg:w-[18px] lg:h-[18px] flex-shrink-0" />
                  Snapshot
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-[16px] border border-slate-100 bg-slate-50/70 p-3 pwa:p-4">
              <div className="flex flex-col pwa:flex-row pwa:items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1">Sumber Kamera</p>
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <span className="text-[12px] pwa:text-[14px] font-bold text-[#1e293b] truncate">{localWebcamActive ? "Webcam Lokal" : getSourceLabel(selectedCamera?.sourceType)}</span>
                  </div>
                </div>
                <button onClick={handleToggleLocalWebcam} disabled={!selectedCamera} className={cn("flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[11px] pwa:text-[12px] font-bold border transition-colors", localWebcamActive ? "bg-red-50 text-red-600 border-red-100 hover:bg-red-100" : "bg-white text-blue-600 border-blue-100 hover:bg-blue-50")}>
                  <Smartphone className="w-4 h-4" />
                  {localWebcamActive ? "Matikan Webcam" : "Webcam Lokal"}
                </button>
              </div>

              <div className="grid grid-cols-1 pwa:grid-cols-[150px_1fr_auto] gap-2">
                <select value={sourceType} onChange={(event) => setSourceType(event.target.value as CameraSourceType)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-blue-300">
                  <option value="mock">Preview Mock</option>
                  <option value="hls">HLS</option>
                  <option value="direct-video">MP4/WebM</option>
                  <option value="phone-webcam">Kamera HP</option>
                  <option value="rtsp">RTSP</option>
                  <option value="nvr">NVR/DVR</option>
                  <option value="webrtc">WebRTC</option>
                </select>
                <input
                  value={streamUrlInput}
                  onChange={(event) => setStreamUrlInput(event.target.value)}
                  placeholder="https://.../index.m3u8 atau http://ip-hp:port/video"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 outline-none focus:border-blue-300"
                />
                <button onClick={() => void handleSaveCameraSource()} disabled={!selectedCamera || isSavingSource} className="flex items-center justify-center gap-2 rounded-xl bg-[#0e59f2] px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 transition-colors">
                  <Save className="w-4 h-4" />
                  {isSavingSource ? "Menyimpan" : "Simpan"}
                </button>
              </div>

              {sourceMessage && (
                <p className="mt-2 text-[11px] pwa:text-[12px] font-medium text-slate-500 leading-relaxed">{sourceMessage}</p>
              )}
            </div>
          </div>

          {/* Daftar Kamera (Right on Desktop, Row 2 on Mobile/Tablet) */}
          <div className="lg:col-span-3 bg-white rounded-[20px] pwa:rounded-[24px] border border-slate-100 shadow-sm p-3 pwa:p-4 lg:p-5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-3 pwa:mb-4">
              <h3 className="text-[14px] pwa:text-[15px] lg:text-[16px] font-bold text-[#1e293b]">Daftar Kamera</h3>
              <button onClick={() => setShowAllCameras((value) => !value)} className="pwa:hidden text-[11px] font-medium text-blue-600">{showAllCameras ? "Ringkas" : "Lihat Semua"}</button>
            </div>
            
            <div className="flex lg:flex-col overflow-x-auto lg:overflow-visible pb-3 lg:pb-0 -mr-3 lg:mr-0 pr-3 lg:pr-0 gap-2.5 lg:gap-3 snap-x snap-mandatory lg:snap-none hide-scrollbar">
              {visibleCameraItems.map((cam) => {
                const isActive = cam.id === selectedCamera?.id;
                const online = isCameraOnline(cam);

                return (
                  <div
                    key={cam.id}
                    onClick={() => setSelectedCameraId(cam.id)}
                    className={cn(
                      "flex flex-col lg:flex-row lg:items-center gap-1.5 lg:gap-4 lg:pb-4 lg:border-b border-slate-100 lg:last:border-0 lg:last:pb-0 w-[120px] pwa:w-[150px] lg:w-full flex-shrink-0 snap-start cursor-pointer",
                      !isActive && "group hover:opacity-80 transition-opacity"
                    )}
                  >
                    <div
                      className={cn(
                        "relative w-full aspect-[16/10] lg:w-24 lg:h-16 lg:aspect-auto bg-slate-200 rounded-[8px] lg:rounded-lg overflow-hidden flex-shrink-0",
                        isActive && "border-2 border-blue-500 lg:border-0"
                      )}
                    >
                      <img src={cam.image} className={`w-full h-full object-cover ${!online ? 'grayscale opacity-70' : ''}`} alt="" />
                      {isActive ? (
                        <div className="absolute inset-0 bg-blue-500/10 lg:bg-transparent"></div>
                      ) : (
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                          <Play className="w-4 h-4 lg:w-4 lg:h-4 text-white fill-white ml-0.5" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 mt-1 lg:mt-0 flex flex-col lg:flex-row lg:items-center lg:justify-between w-full">
                      <div className="min-w-0">
                        <h4 className={cn("text-[11px] pwa:text-[12px] lg:text-[13px] font-bold truncate text-left", isActive ? "text-blue-600 lg:text-[#1e293b]" : "text-[#1e293b]")}>{cam.name}</h4>
                        <p className="text-[10px] lg:text-[11px] text-slate-500 truncate mb-0.5 hidden lg:block">{cam.location}</p>
                        <div className="flex items-center justify-start gap-1 lg:mt-0.5">
                          {online ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 lg:w-3.5 lg:h-3.5 text-emerald-500" />
                              <span className="text-[10px] lg:text-[11px] font-medium text-emerald-600">Online</span>
                            </>
                          ) : (
                            <>
                              <Circle className="w-2.5 h-2.5 lg:w-3 lg:h-3 text-red-500 fill-red-500" />
                              <span className="text-[10px] lg:text-[11px] font-medium text-red-600">Offline</span>
                            </>
                          )}
                        </div>
                      </div>
                      {isActive && (
                        <div className="hidden lg:flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="w-4 h-4 lg:w-5 lg:h-5 text-blue-500" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Section: Aktivitas & Indikasi Kejadian */}
        <div className="grid grid-cols-1 gap-6">
          
          {/* Aktivitas & Indikasi Kejadian */}
          <div className="flex flex-col gap-6">
            
            {/* Aktivitas Card */}
            <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-4 pwa:p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4 pwa:mb-5">
                <h3 className="text-[15px] pwa:text-[16px] font-bold text-[#1e293b]">
                  <span className="hidden pwa:inline">Aktivitas & Indikasi Kejadian</span>
                  <span className="pwa:hidden">Aktivitas Terbaru</span>
                </h3>
                <button onClick={() => router.push("/laporan")} className="text-[11px] pwa:text-[13px] font-medium text-blue-600 hover:text-blue-700">Lihat Semua</button>
              </div>

              <div className="space-y-3 pwa:space-y-4">
                {activityItems.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 pwa:gap-4 lg:gap-6 pb-3 pwa:pb-4 border-b border-slate-50 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3 pwa:gap-4 flex-1 min-w-0">
                      <div className={`w-8 h-8 pwa:w-10 pwa:h-10 rounded-lg pwa:rounded-xl ${log.bg} flex items-center justify-center flex-shrink-0`}>
                        <ShieldAlert className={`w-4 h-4 pwa:w-5 pwa:h-5 ${log.color}`} />
                      </div>
                      <div className="flex flex-col pwa:flex-row pwa:items-center gap-1 pwa:gap-4 lg:gap-12 flex-1 min-w-0">
                        <div className="w-16 pwa:w-24 flex-shrink-0">
                          <p className="text-[11px] pwa:text-[13px] font-bold text-[#1e293b]">{log.time} WIB</p>
                          <p className="text-[11px] text-slate-500 hidden pwa:block">{log.date}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-[#1e293b] truncate hidden pwa:flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-400 inline"/> {log.loc}</p>
                          <p className="text-[12px] font-bold text-[#1e293b] truncate pwa:hidden leading-tight">{log.loc}</p>
                          <p className="text-[11px] text-slate-500 truncate hidden pwa:block">{log.locationDetail}</p>
                          <p className="text-[10px] text-slate-500 truncate pwa:hidden leading-tight mt-0.5">{log.title}</p>
                        </div>
                        <div className="flex-1 min-w-0 hidden pwa:block">
                          <p className="text-[13px] font-bold text-[#1e293b] truncate">{log.title}</p>
                          <p className="text-[11px] text-slate-500 truncate">{log.desc}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] pwa:text-[11px] px-2 py-0.5 pwa:px-3 pwa:py-1 rounded-full font-bold ${log.badge}`}>
                        {log.status}
                      </span>
                      <MoreVertical className="w-4 h-4 text-slate-400 pwa:hidden ml-0.5" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rekaman Cepat */}
            <div className="hidden pwa:flex bg-white rounded-[24px] border border-slate-100 shadow-sm p-6 flex-col">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-[16px] font-bold text-[#1e293b]">Rekaman Cepat (Clip Tersimpan Hari Ini)</h3>
                <button onClick={() => router.push("/rekaman")} className="text-[13px] font-medium text-blue-600 hover:text-blue-700">Lihat Semua</button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {quickRecordingItems.map((rec) => (
                  <div key={rec.id} className="flex flex-col gap-2">
                    <div className="relative w-full aspect-[16/9] bg-slate-200 rounded-xl overflow-hidden group cursor-pointer">
                      <img src={rec.img} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt="" />
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/40">
                          <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                      <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] px-2 py-0.5 rounded-md font-bold">
                        {rec.duration}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div>
                        <h4 className="text-[12px] font-bold text-slate-500">{rec.time}</h4>
                        <p className="text-[13px] font-bold text-[#1e293b] truncate">{rec.title}</p>
                      </div>
                      <button onClick={() => router.push(`/rekaman?recordingId=${encodeURIComponent(rec.id)}`)} className="px-3 py-1.5 text-[11px] font-bold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
                        Lihat
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>



      </div>
    </div>
  );
}

function downloadSnapshot(canvas: HTMLCanvasElement, cameraId: string) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `snapshot-${cameraId}-${Date.now()}.png`;
  link.click();
}

function getSourceLabel(sourceType: CameraSourceType | undefined) {
  const labels: Record<CameraSourceType, string> = {
    mock: "Preview Mock",
    "local-webcam": "Webcam Lokal",
    "phone-webcam": "Kamera HP",
    hls: "HLS",
    "direct-video": "MP4/WebM",
    webrtc: "WebRTC",
    rtsp: "RTSP",
    nvr: "NVR/DVR",
  };
  return labels[sourceType ?? "mock"];
}

function getSourceSaveMessage(sourceType: CameraSourceType) {
  if (sourceType === "rtsp") return "Sumber RTSP tersimpan. Playback browser perlu media gateway ke HLS atau WebRTC.";
  if (sourceType === "nvr") return "Sumber NVR/DVR tersimpan. Playback real perlu gateway NVR/media service.";
  if (sourceType === "webrtc") return "Sumber WebRTC tersimpan. Playback real perlu signaling server.";
  if (sourceType === "mock") return "Sumber dikembalikan ke preview mock.";
  return "Sumber kamera tersimpan.";
}
