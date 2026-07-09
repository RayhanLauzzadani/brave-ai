"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Calendar as CalendarIcon,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Folder,
  Lock,
  MapPin,
  Menu,
  MoreHorizontal,
  MoreVertical,
  Play,
  RefreshCw,
  Search,
  VideoOff,
  Film,
  ShieldCheck,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { MobileSidebar } from "@/components/layout/mobile-nav";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { TimelineScrubber } from "@/components/ui/timeline-scrubber";
import {
  VideoTrimmerModal,
  type VideoTrimExportPayload,
} from "@/components/ui/video-trimmer-modal";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { getCameras } from "@/lib/api/cameras";
import { getBullyingLogs } from "@/lib/api/bullying-logs";
import { createEvidenceClip, getRecordings } from "@/lib/api/recordings";
import type { BullyingLog, Camera as CameraType, Recording, RecordingStatus } from "@/lib/types";

const STATUS_OPTIONS: Array<{ value: "all" | RecordingStatus; label: string }> = [
  { value: "all", label: "Semua Status" },
  { value: "tersimpan", label: "Tersimpan" },
  { value: "ditinjau", label: "Ditinjau" },
  { value: "terkunci", label: "Terkunci" },
];

const FALLBACK_THUMBNAILS = [
  "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1590402494682-cd3fb53b1f70?q=80&w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=900&auto=format&fit=crop",
];

type TimelineMarker = {
  id: string;
  time: string;
  description: string;
};

export default function RekamanPage() {
  const router = useRouter();
  const unreadCount = useAlertStore((s) => s.unreadCount);
  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);

  const [records, setRecords] = useState<Recording[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [logs, setLogs] = useState<BullyingLog[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState("00:00");
  const [isTrimmerOpen, setIsTrimmerOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(() => new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isLokasiOpen, setIsLokasiOpen] = useState(false);
  const [isKameraOpen, setIsKameraOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [selectedLokasi, setSelectedLokasi] = useState("all");
  const [selectedKamera, setSelectedKamera] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | RecordingStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const dateRange = useMemo(() => getSevenDayRange(date ?? new Date()), [date]);

  const loadRecordingData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const [cameraResult, logResult, recordingResult] = await Promise.all([
        getCameras(),
        getBullyingLogs(),
        getRecordings({
          cameraId: selectedKamera === "all" ? undefined : selectedKamera,
          dateFrom: dateRange.from.toISOString(),
          dateTo: dateRange.to.toISOString(),
          status: selectedStatus,
          search: searchTerm.trim() || undefined,
        }),
      ]);

      setCameras(cameraResult);
      setLogs(logResult);
      setRecords(recordingResult);
      setSelectedRecordId((current) => {
        if (current && recordingResult.some((record) => record.id === current)) {
          return current;
        }
        return recordingResult[0]?.id ?? null;
      });
      if (!selectedRecordId && recordingResult[0]) {
        setSelectedTime(toScrubberTime(recordingResult[0].startTime));
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Rekaman belum bisa dimuat. Coba lagi."
      );
      setRecords([]);
    } finally {
      setIsLoading(false);
    }
  }, [dateRange.from, dateRange.to, searchTerm, selectedKamera, selectedRecordId, selectedStatus]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadRecordingData();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadRecordingData]);

  const lokasiOptions = useMemo(() => {
    const locations = Array.from(new Set(cameras.map((camera) => camera.location))).sort();
    return [
      { value: "all", label: "Semua Lokasi" },
      ...locations.map((location) => ({ value: location, label: location })),
    ];
  }, [cameras]);

  const kameraOptions = useMemo(
    () => [
      { value: "all", label: "Semua Kamera" },
      ...cameras.map((camera) => ({ value: camera.id, label: camera.name })),
    ],
    [cameras]
  );

  const recordsWithImage = useMemo(
    () =>
      records.map((record, index) => ({
        ...record,
        image: getRecordingImage(record, cameras, index),
      })),
    [cameras, records]
  );

  const visibleRecords = useMemo(() => {
    if (selectedLokasi === "all") return recordsWithImage;
    return recordsWithImage.filter((record) => record.location === selectedLokasi);
  }, [recordsWithImage, selectedLokasi]);

  const selectedRecord = useMemo(
    () =>
      visibleRecords.find((record) => record.id === selectedRecordId) ??
      visibleRecords[0] ??
      null,
    [selectedRecordId, visibleRecords]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!selectedRecord) {
        setSelectedRecordId(null);
        return;
      }
      if (selectedRecord.id !== selectedRecordId) {
        setSelectedRecordId(selectedRecord.id);
        setSelectedTime(toScrubberTime(selectedRecord.startTime));
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectedRecord, selectedRecordId]);

  const incidentMarkers = useMemo(() => {
    if (!selectedRecord) return [];
    const start = new Date(selectedRecord.startTime).getTime();
    const end = new Date(selectedRecord.endTime).getTime();

    return logs
      .filter((log) => {
        const timestamp = new Date(log.timestamp).getTime();
        return (
          log.cameraId === selectedRecord.cameraId &&
          timestamp >= start &&
          timestamp <= end
        );
      })
      .map((log) => ({
        id: log.id,
        time: toScrubberTime(log.timestamp),
        description: log.title,
      })) satisfies TimelineMarker[];
  }, [logs, selectedRecord]);

  const importantRecords = useMemo(() => {
    const important = visibleRecords.filter(
      (record) => record.hasIncident || record.status === "terkunci"
    );
    return (important.length > 0 ? important : visibleRecords).slice(0, 4);
  }, [visibleRecords]);

  const selectedAvailable = selectedRecord?.storageStatus === "available";

  const selectRecord = (record: Recording) => {
    setSelectedRecordId(record.id);
    setSelectedTime(toScrubberTime(record.startTime));
    setActionMessage("");
  };

  const openTrimmer = (record?: Recording) => {
    const target = record ?? selectedRecord;
    if (!target) return;
    selectRecord(target);
    if (target.storageStatus === "unavailable") {
      setActionMessage("Rekaman tidak tersedia dari NVR/DVR pada waktu tersebut.");
      return;
    }
    setIsTrimmerOpen(true);
  };

  const handleExportClip = async (payload: VideoTrimExportPayload) => {
    if (!selectedRecord) return;
    if (selectedRecord.storageStatus === "unavailable") {
      throw new Error("Rekaman tidak tersedia dari NVR/DVR pada waktu tersebut.");
    }

    const clip = await createEvidenceClip(selectedRecord.id, {
      cameraId: selectedRecord.cameraId,
      startTime: combineDateAndTime(selectedRecord.startTime, payload.startLabel).toISOString(),
      endTime: combineDateAndTime(selectedRecord.startTime, payload.endLabel).toISOString(),
      reason: "recording_view_trim_export",
    });

    setActionMessage(`Clip bukti ${clip.id} masuk antrean export.`);
  };

  const handleSnapshot = () => {
    if (!selectedRecord || selectedRecord.storageStatus === "unavailable") return;

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
    context.fillText(selectedRecord.cameraName, 64, 100);
    context.font = "26px Arial";
    context.fillText(`${selectedRecord.location} - ${formatRecordDate(selectedRecord.startTime)} ${selectedTime} WIB`, 64, 146);
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.fillRect(64, 210, 1152, 360);
    context.fillStyle = "#bfdbfe";
    context.font = "bold 34px Arial";
    context.fillText("BRAVE AI RECORDING SNAPSHOT", 64, 650);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `recording-snapshot-${selectedRecord.id}-${Date.now()}.png`;
    link.click();
    setActionMessage("Snapshot rekaman berhasil dibuat dari preview.");
  };

  const handleCreateReport = () => {
    if (!selectedRecord) return;
    router.push(`/laporan?recordingId=${encodeURIComponent(selectedRecord.id)}`);
  };
  return (
    <div className="bg-[#f4f7fb] min-h-full -m-4 p-4 pwa:-m-6 pwa:p-6 font-sans text-slate-900 pb-24 pwa:pb-6">
      {/* Mobile Top Bar with Title */}
      <div className="flex lg:hidden items-center justify-between mb-6">
        <div className="flex items-center gap-3 pwa:gap-4 flex-1 min-w-0">
          <div className="hidden pwa:flex items-center">
            <Sheet>
              <SheetTrigger render={<button className="p-2 -ml-2 rounded-lg hover:bg-slate-200 transition-colors flex-shrink-0 focus:outline-none" />}>
                <Menu className="w-6 h-6 text-[#1e293b]" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 bg-[#064eb7] border-white/[0.06] text-white">
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <MobileSidebar />
              </SheetContent>
            </Sheet>
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            <h1 className="text-[18px] pwa:text-[20px] font-bold text-[#0f172a] tracking-tight leading-tight truncate">Rekaman</h1>
            <p className="text-[11px] font-desc text-slate-500 truncate mt-0.5">Kelola rekaman video tersimpan sebagai bukti kejadian dengan aman.</p>
          </div>
        </div>

        <button className="relative p-2 rounded-full hover:bg-slate-200 transition-colors flex-shrink-0">
          <Bell className="w-6 h-6 text-[#1e293b]" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-[#f4f7fb]">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      <div className="max-w-7xl mx-auto space-y-6">
        <div className={cn(
          "hidden lg:flex fixed top-0 right-0 z-40 bg-white items-center justify-between h-16 px-6 lg:px-8 border-b border-slate-100 shadow-sm transition-[left] duration-300",
          isCollapsed ? "lg:left-20" : "lg:left-64"
        )}>
          <div>
            <h2 className="text-[15px] font-bold text-[#0f172a]">Rekaman</h2>
            <p className="text-[11px] font-desc text-slate-500 -mt-0.5">Kelola rekaman video tersimpan sebagai bukti kejadian dengan aman.</p>
          </div>
          <div className="flex items-center gap-4">
            <button className="relative flex items-center justify-center w-9 h-9 rounded-full bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <Bell className="w-[18px] h-[18px]" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="hidden lg:block h-10" />

        {/* Filter and Search Bar */}
        <div className="flex flex-col gap-3 pwa:flex-row pwa:gap-4 mb-6">
          {/* Search Bar — pill shape on mobile, standard on tablet+ */}
          <div className="relative flex-1">
            <Search className="w-[18px] h-[18px] pwa:w-5 pwa:h-5 text-slate-400 absolute left-3.5 pwa:left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Cari kamera, lokasi, atau tanggal..."
              className="w-full pl-10 pwa:pl-10 pr-4 py-2.5 pwa:py-2.5 bg-white rounded-full pwa:rounded-xl border border-slate-200/60 pwa:border-slate-200 text-[13px] pwa:text-sm outline-none focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 pwa:focus:border-blue-500 pwa:focus:ring-1 pwa:focus:ring-blue-500 transition-all placeholder:text-slate-400 pwa:shadow-sm"
            />
          </div>
          {/* Filter Chips */}
          <div className="flex overflow-x-auto hide-scrollbar gap-2 pb-0.5 pwa:pb-0 pwa:items-center -mx-1 px-1 pwa:mx-0 pwa:px-0">
            {/* 1. Date Filter: Always visible on mobile and desktop */}
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger className={cn(
                "flex shrink-0 items-center gap-1.5 px-3.5 py-[7px] pwa:px-4 pwa:py-2.5 rounded-full pwa:rounded-xl text-[12px] pwa:text-sm font-semibold pwa:font-medium whitespace-nowrap transition-all",
                date
                  ? "bg-blue-50 text-[#064eb7] border border-blue-200 pwa:bg-white pwa:text-slate-700 pwa:border-slate-200 pwa:shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200/60 pwa:bg-white pwa:text-slate-500 pwa:border-slate-200 pwa:shadow-sm"
              )}>
                <CalendarIcon className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" />
                {date ? format(date, "d MMM yyyy", { locale: id }) : <span>Tanggal</span>}
                <ChevronDown className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 opacity-50" />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-white border border-slate-200 shadow-lg rounded-xl text-slate-800" align="start">
                <div className="[&_[data-selected-single=true]]:!bg-[#1b64f2] [&_[data-selected-single=true]]:!text-white [&_.bg-muted]:!bg-slate-100 [&_.text-muted-foreground]:!text-slate-500 [&_.hover\:bg-accent]:hover:!bg-slate-50">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(newDate) => {
                      setDate(newDate);
                      setIsCalendarOpen(false);
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>

            {/* 2. Unified Filter Button (Mobile Only) */}
            <div className="pwa:hidden">
              <Sheet open={isMobileFilterOpen} onOpenChange={setIsMobileFilterOpen}>
                <SheetTrigger className={cn(
                  "flex shrink-0 items-center gap-1.5 px-3.5 py-[7px] rounded-full text-[12px] font-semibold whitespace-nowrap transition-all",
                  (selectedLokasi !== "all" || selectedStatus !== "all" || selectedKamera !== "all")
                    ? "bg-blue-50 text-[#064eb7] border border-blue-200"
                    : "bg-white text-slate-600 border border-slate-200/60"
                )}>
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Filter
                  <ChevronDown className="w-3.5 h-3.5 opacity-50" />
                </SheetTrigger>
                <SheetContent side="bottom" showCloseButton={false} className="rounded-t-[20px] px-0 pb-0 pt-0 max-h-[85vh] flex flex-col bg-white"
                  onPointerDown={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.dataset.swipeY = String(e.clientY);
                  }}
                  onPointerUp={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    const startY = Number(el.dataset.swipeY || 0);
                    if (startY && e.clientY - startY > 60) setIsMobileFilterOpen(false);
                    el.dataset.swipeY = "";
                  }}
                >
                  {/* Handle bar — swipe area */}
                  <div className="pt-3 pb-2 cursor-grab">
                    <div className="w-9 h-[3px] bg-slate-300 rounded-full mx-auto" />
                  </div>

                  {/* Modal Header */}
                  <div className="flex items-center justify-between px-5 pb-3">
                    <SheetTitle className="text-[15px] font-bold text-[#0f172a]">Filter</SheetTitle>
                    <SheetClose className="p-1.5 -mr-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                      <X className="w-5 h-5" />
                    </SheetClose>
                  </div>

                  {/* Separator + Reset */}
                  <div className="flex items-center justify-between px-5 py-2.5 border-y border-slate-100 bg-slate-50/50">
                    <span className="text-[12px] font-medium text-slate-400 uppercase tracking-wider">Pilih filter</span>
                    <button
                      onClick={() => {
                        setSelectedLokasi("all");
                        setSelectedStatus("all");
                        setSelectedKamera("all");
                      }}
                      className="text-[13px] font-semibold text-[#064eb7] hover:text-[#053e94] transition-colors"
                    >
                      Reset
                    </button>
                  </div>

                  {/* Modal Body */}
                  <div className="overflow-y-auto px-5 py-5 space-y-6 flex-1">
                    {/* Lokasi */}
                    <div>
                      <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wide mb-3">Lokasi</h3>
                      <div className="flex flex-wrap gap-2">
                        {lokasiOptions.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setSelectedLokasi(opt.value)}
                            className={cn(
                              "px-4 py-2 rounded-full text-[13px] font-medium transition-all border",
                              selectedLokasi === opt.value
                                ? "bg-[#064eb7] text-white border-[#064eb7] shadow-sm"
                                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wide mb-3">Status</h3>
                      <div className="flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setSelectedStatus(opt.value)}
                            className={cn(
                              "px-4 py-2 rounded-full text-[13px] font-medium transition-all border",
                              selectedStatus === opt.value
                                ? "bg-[#064eb7] text-white border-[#064eb7] shadow-sm"
                                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Kamera */}
                    <div>
                      <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wide mb-3">Kamera</h3>
                      <div className="flex flex-wrap gap-2">
                        {kameraOptions.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setSelectedKamera(opt.value)}
                            className={cn(
                              "px-4 py-2 rounded-full text-[13px] font-medium transition-all border",
                              selectedKamera === opt.value
                                ? "bg-[#064eb7] text-white border-[#064eb7] shadow-sm"
                                : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Modal Footer */}
                  <div className="px-5 py-4 border-t border-slate-100 bg-white">
                    <button
                      onClick={() => setIsMobileFilterOpen(false)}
                      className="w-full bg-[#064eb7] hover:bg-[#053e94] active:scale-[0.98] text-white rounded-2xl py-3 text-[14px] font-bold shadow-sm transition-all"
                    >
                      Terapkan Filter
                    </button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* 3. Desktop Filter Dropdowns (Tablet+ Only) */}
            <div className="hidden pwa:flex items-center gap-2">
              <Popover open={isLokasiOpen} onOpenChange={setIsLokasiOpen}>
                <PopoverTrigger className={cn(
                  "flex shrink-0 items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors",
                  selectedLokasi !== "all"
                    ? "bg-white text-slate-700 border-slate-200 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 shadow-sm border"
                )}>
                  <MapPin className="w-4 h-4 text-slate-400 pwa:text-slate-500" />
                  {lokasiOptions.find((option) => option.value === selectedLokasi)?.label ?? "Lokasi"}
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </PopoverTrigger>
                <PopoverContent className="w-auto min-w-[180px] p-1.5 bg-white border border-slate-200 shadow-lg rounded-xl" align="start">
                  {lokasiOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setSelectedLokasi(option.value); setIsLokasiOpen(false); }}
                      className={cn(
                        "flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors text-left",
                        selectedLokasi === option.value ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {option.label}
                      {selectedLokasi === option.value && <Check className="w-4 h-4 text-blue-600 ml-3" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              <Popover open={isKameraOpen} onOpenChange={setIsKameraOpen}>
                <PopoverTrigger className={cn(
                  "flex shrink-0 items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors",
                  selectedKamera !== "all"
                    ? "bg-white text-slate-700 border-slate-200 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 shadow-sm border"
                )}>
                  <Camera className="w-4 h-4 text-slate-400 pwa:text-slate-500" />
                  {kameraOptions.find((option) => option.value === selectedKamera)?.label ?? "Kamera"}
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </PopoverTrigger>
                <PopoverContent className="w-auto min-w-[180px] p-1.5 bg-white border border-slate-200 shadow-lg rounded-xl" align="start">
                  {kameraOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setSelectedKamera(option.value); setIsKameraOpen(false); }}
                      className={cn(
                        "flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors text-left",
                        selectedKamera === option.value ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {option.label}
                      {selectedKamera === option.value && <Check className="w-4 h-4 text-blue-600 ml-3" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              <Popover open={isStatusOpen} onOpenChange={setIsStatusOpen}>
                <PopoverTrigger className={cn(
                  "flex shrink-0 items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors",
                  selectedStatus !== "all"
                    ? "bg-white text-slate-700 border-slate-200 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 shadow-sm border"
                )}>
                  <ShieldCheck className="w-4 h-4 text-slate-400 pwa:text-slate-500" />
                  {STATUS_OPTIONS.find((option) => option.value === selectedStatus)?.label ?? "Status"}
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </PopoverTrigger>
                <PopoverContent className="w-auto min-w-[180px] p-1.5 bg-white border border-slate-200 shadow-lg rounded-xl" align="start">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setSelectedStatus(option.value); setIsStatusOpen(false); }}
                      className={cn(
                        "flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors text-left",
                        selectedStatus === option.value ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {option.label}
                      {selectedStatus === option.value && <Check className="w-4 h-4 text-blue-600 ml-3" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 flex flex-col">
            <div className="bg-white rounded-2xl pwa:rounded-[24px] border border-slate-100 shadow-sm overflow-hidden mb-4 pwa:mb-6">
              <div className="flex items-center justify-between p-4 pwa:p-5 border-b-0 pwa:border-b border-slate-100">
                <h2 className="text-[16px] pwa:text-[18px] font-bold text-[#1e293b]">Daftar Rekaman</h2>
                <button onClick={() => void loadRecordingData()} className="flex items-center gap-0.5 text-[11px] pwa:text-sm font-medium text-blue-500 pwa:text-slate-500 cursor-pointer hover:text-blue-600 pwa:hover:text-slate-800 transition-colors bg-transparent pwa:bg-slate-50 px-1 pwa:px-3 py-1 pwa:py-1.5 rounded-lg pwa:border pwa:border-slate-100">
                  <RefreshCw className={cn("w-3.5 h-3.5 pwa:w-4 pwa:h-4", isLoading && "animate-spin")} />
                  Muat Ulang
                </button>
              </div>

              <div className="flex flex-col px-0 pb-0">
                {errorMessage ? (
                  <div className="m-0 p-4 pwa:m-4 rounded-xl border border-red-100 bg-red-50 text-red-700 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">Rekaman gagal dimuat</p>
                      <p className="text-xs mt-1 leading-relaxed">{errorMessage}</p>
                      <button onClick={() => void loadRecordingData()} className="mt-3 px-3 py-1.5 text-xs font-bold bg-white border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                        Coba Lagi
                      </button>
                    </div>
                  </div>
                ) : isLoading ? (
                  <div className="p-4 pwa:p-6 text-sm text-slate-500 font-medium">Memuat rekaman 7 hari terakhir...</div>
                ) : visibleRecords.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-4">
                      <VideoOff className="w-7 h-7 text-slate-400" />
                    </div>
                    <h3 className="text-[14px] pwa:text-[15px] font-bold text-[#1e293b] mb-1.5">Tidak ada rekaman</h3>
                    <p className="text-[12px] pwa:text-[13px] text-slate-500 font-medium max-w-[280px]">Belum ada data rekaman pada tanggal, lokasi, atau kamera ini.</p>
                  </div>
                ) : (                  visibleRecords.map((record) => (
                    <div
                      key={record.id}
                      onClick={() => selectRecord(record)}
                      className={`flex flex-row pwa:items-center gap-3 pwa:gap-4 p-3 pwa:p-4 border-b border-slate-100 last:border-0 pwa:last:border-0 cursor-pointer transition-colors ${
                        selectedRecord?.id === record.id
                          ? 'bg-blue-50/50 border-b-blue-200'
                          : 'hover:bg-slate-50 bg-transparent'
                      }`}
                    >
                      <div className="relative w-[100px] pwa:w-40 aspect-[4/3] pwa:aspect-video rounded-[8px] pwa:rounded-xl overflow-hidden flex-shrink-0">
                        <img src={record.image} alt={record.cameraName} className={cn("w-full h-full object-cover", record.storageStatus === "unavailable" && "grayscale opacity-60")} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-7 h-7 pwa:w-8 pwa:h-8 rounded-full bg-black/60 flex items-center justify-center">
                            {record.storageStatus === "unavailable" ? <AlertTriangle className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 text-white" /> : <Play className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 text-white fill-white ml-0.5" />}
                          </div>
                        </div>
                        <div className="absolute bottom-1 right-1 pwa:bottom-1.5 pwa:right-1.5 bg-black/80 px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold text-white leading-none shadow-sm">
                          {formatDuration(record.duration)}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-between py-0">
                        <div>
                          <h3 className="text-[13px] pwa:text-[15px] font-bold text-[#1e293b] mb-0.5 pwa:mb-1 truncate">{record.cameraName}</h3>
                          <div className="flex flex-col gap-0.5 pwa:gap-1 text-[10px] pwa:text-xs text-slate-500">
                            <span className="flex items-center gap-1.5 pwa:hidden">
                              {formatRecordDate(record.startTime)} {formatRecordTime(record.startTime)}
                            </span>
                            <span className="hidden pwa:flex items-center gap-1.5">
                              <CalendarIcon className="w-3.5 h-3.5" /> {formatRecordDate(record.startTime)} {formatRecordTime(record.startTime)}
                            </span>
                            <span className="hidden pwa:flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5" /> {record.location}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between pwa:justify-end gap-2 pwa:gap-3 mt-auto pwa:mt-0 pt-1.5 pwa:pt-0">
                          <div className={`hidden pwa:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold ${getStatusStyle(record.status)}`}>
                            {getStatusIcon(record.status)}
                            {getStatusLabel(record.status)}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <button onClick={(event) => { event.stopPropagation(); selectRecord(record); }} className="px-2.5 sm:px-3 pwa:px-3 py-1 pwa:py-1.5 text-blue-600 font-semibold text-[11px] pwa:text-xs bg-white pwa:bg-blue-50 hover:bg-blue-50 pwa:hover:bg-blue-100 rounded-[6px] pwa:rounded-lg transition-colors border border-blue-200 pwa:border-blue-100">
                              Lihat
                            </button>
                            {record.storageStatus === "available" ? (
                              <button onClick={(event) => { event.stopPropagation(); openTrimmer(record); }} className="flex items-center justify-center gap-1 px-2.5 sm:px-3 pwa:px-3 py-1 pwa:py-1.5 text-blue-600 font-semibold text-[11px] pwa:text-xs bg-white hover:bg-blue-50 border border-blue-200 pwa:border-blue-200 rounded-[6px] pwa:rounded-lg transition-colors">
                                <Lock className="w-3 h-3 pwa:w-3.5 pwa:h-3.5" /> Simpan
                              </button>
                            ) : (
                              <button onClick={(event) => { event.stopPropagation(); selectRecord(record); }} className="flex items-center justify-center gap-1 px-2.5 sm:px-3 pwa:px-3 py-1 pwa:py-1.5 text-blue-600 pwa:text-purple-600 font-semibold text-[11px] pwa:text-xs bg-white hover:bg-blue-50 pwa:hover:bg-purple-50 border border-blue-200 pwa:border-purple-200 rounded-[6px] pwa:rounded-lg transition-colors">
                                <Lock className="w-3 h-3 pwa:hidden" /> Detail
                              </button>
                            )}
                            <button className="hidden pwa:block p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
                              <MoreVertical className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between p-3 pwa:p-5 border-t border-slate-100 bg-slate-50/50 mt-0 pwa:mt-auto">
                <span className="text-xs text-slate-500 font-medium hidden pwa:block">Menampilkan {visibleRecords.length} dari {records.length} rekaman</span>
                <div className="flex items-center gap-1 pwa:gap-2 mx-auto pwa:mx-0">
                  <button className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors disabled:opacity-50" disabled>
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-sm">
                    1
                  </button>
                  <span className="w-8 h-8 flex items-center justify-center text-slate-400">
                    <MoreHorizontal className="w-4 h-4" />
                  </span>
                  <button className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 transition-colors" disabled>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col">
            <div className="bg-white rounded-2xl pwa:rounded-[24px] border border-slate-100 shadow-sm flex flex-col mb-6 lg:mb-0 overflow-hidden">
              <div className="px-4 py-3.5 pwa:px-5 pwa:py-5 border-b border-slate-100 mb-4 pwa:mb-5">
                <h2 className="text-[16px] pwa:text-[18px] font-bold text-[#1e293b]">Detail Rekaman Terpilih</h2>
              </div>

              <div className="px-4 pwa:px-5 pb-4 pwa:pb-5 flex flex-col flex-1">
                {selectedRecord ? (
                  <>
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden mb-5 bg-black">
                      <img src={selectedRecord.image} alt={selectedRecord.cameraName} className={cn("w-full h-full object-cover opacity-70", !selectedAvailable && "grayscale opacity-40")} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <button disabled={!selectedAvailable} className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-white/20 hover:bg-black/80 transition-colors hover:scale-105 disabled:hover:scale-100 disabled:opacity-80">
                          {selectedAvailable ? <Play className="w-5 h-5 text-white fill-white ml-1" /> : <AlertTriangle className="w-5 h-5 text-white" />}
                        </button>
                      </div>
                      <div className={cn("absolute top-3 left-3 text-white px-2 py-0.5 rounded text-[10px] font-bold tracking-widest flex items-center gap-1.5", selectedAvailable ? "bg-red-500 animate-pulse" : "bg-amber-500")}>
                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        {selectedAvailable ? "LIVE RECORDING" : "NVR/DVR ERROR"}
                      </div>
                      <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded flex items-center gap-1 text-[11px] font-bold text-white border border-white/20">
                        {selectedRecord.cameraName} - {selectedTime}
                      </div>
                    </div>

                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-700">Timeline Hari Ini</span>
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                          <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-1" />
                          Indikasi Bullying
                        </span>
                      </div>
                      {selectedAvailable ? (
                        <TimelineScrubber
                          markers={incidentMarkers}
                          initialTime={selectedTime}
                          onTimeChange={(time) => setSelectedTime(time)}
                        />
                      ) : (
                        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs font-medium text-amber-700 leading-relaxed">
                          Pusat kontrol kamera tidak menyimpan rekaman pada waktu ini, jadi timeline dan playback tidak tersedia.
                        </div>
                      )}
                    </div>                    <div className="flex flex-col gap-2.5 pwa:gap-3 mb-6">
                      <div className="flex items-start">
                        <div className="w-28 pwa:w-32 flex items-center gap-1.5 pwa:gap-2 text-slate-500 text-[11px] pwa:text-xs">
                          <Camera className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" /> Nama Kamera
                        </div>
                        <div className="flex-1 text-[13px] pwa:text-[14px] font-bold text-[#1e293b]">{selectedRecord.cameraName}</div>
                      </div>
                      <div className="flex items-start">
                        <div className="w-28 pwa:w-32 flex items-center gap-1.5 pwa:gap-2 text-slate-500 text-[11px] pwa:text-xs">
                          <MapPin className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" /> Lokasi
                        </div>
                        <div className="flex-1 text-[13px] pwa:text-[14px] font-medium text-[#1e293b]">{selectedRecord.location}</div>
                      </div>
                      <div className="flex items-start">
                        <div className="w-28 pwa:w-32 flex items-center gap-1.5 pwa:gap-2 text-slate-500 text-[11px] pwa:text-xs">
                          <Clock className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" /> Waktu Terpilih
                        </div>
                        <div className="flex-1 text-[13px] pwa:text-[14px] font-medium text-[#1e293b]">{formatRecordDate(selectedRecord.startTime)} <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{selectedTime}</span></div>
                      </div>
                      <div className="flex items-start">
                        <div className="w-28 pwa:w-32 flex items-center gap-1.5 pwa:gap-2 text-slate-500 text-[11px] pwa:text-xs">
                          <Clock className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" /> Durasi
                        </div>
                        <div className="flex-1 text-[13px] pwa:text-[14px] font-medium text-[#1e293b]">{formatDuration(selectedRecord.duration)}</div>
                      </div>
                      <div className="flex items-start">
                        <div className="w-28 pwa:w-32 flex items-center gap-1.5 pwa:gap-2 text-slate-500 text-[11px] pwa:text-xs">
                          <Folder className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" /> Penyimpanan
                        </div>
                        <div className="flex-1">
                          <div className={cn("inline-flex items-center gap-1.5 font-bold text-[11px] pwa:text-xs", selectedAvailable ? "text-emerald-600" : "text-amber-600")}>
                            {selectedAvailable ? <Lock className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                            {selectedAvailable ? "Aman (Terkunci Audit)" : "NVR/DVR tidak tersedia"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5 mb-5">
                      <button
                        onClick={() => openTrimmer()}
                        disabled={!selectedAvailable}
                        className="w-full flex items-center justify-center gap-2 bg-[#1b64f2] hover:bg-blue-700 text-white py-3 rounded-xl font-bold text-sm transition-colors shadow-sm disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        <Lock className="w-4 h-4" /> Potong & Simpan Klip ({selectedTime})
                      </button>
                      <div className="grid grid-cols-2 gap-2.5">
                        <button onClick={handleSnapshot} disabled={!selectedAvailable} className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-blue-600 border border-blue-200 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-sm disabled:text-slate-400 disabled:border-slate-200">
                          <Camera className="w-4 h-4" /> Snapshot
                        </button>
                        <button onClick={handleCreateReport} className="w-full flex items-center justify-center gap-2 bg-purple-50 hover:bg-purple-100 text-purple-600 border border-purple-100 py-2.5 rounded-xl font-bold text-sm transition-colors shadow-sm">
                          <ShieldCheck className="w-4 h-4" /> Buat Laporan
                        </button>
                      </div>
                    </div>

                    {actionMessage && (
                      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-start gap-3 mb-3">
                        <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-800 leading-relaxed font-medium">{actionMessage}</p>
                      </div>
                    )}

                    <div className={cn("border rounded-xl p-3 flex items-start gap-3 mt-auto", selectedAvailable ? "bg-blue-50/50 border-blue-100" : "bg-amber-50/70 border-amber-100")}>
                      {selectedAvailable ? <ShieldCheck className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />}
                      <p className={cn("text-xs leading-relaxed font-medium", selectedAvailable ? "text-blue-800" : "text-amber-800")}>
                        {selectedAvailable ? "Rekaman ini dilindungi dan tidak dapat dihapus untuk menjaga keaslian bukti." : "Exception flow aktif: NVR/DVR kamera tidak menayangkan rekaman ulang pada detik atau jam tertentu."}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center">
                    <div className="w-20 h-20 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-5">
                      <Film className="w-9 h-9 text-slate-400" />
                    </div>
                    <h3 className="text-[15px] pwa:text-[16px] font-bold text-[#1e293b] mb-2">Pilih Rekaman</h3>
                    <p className="text-[13px] pwa:text-[14px] text-slate-500 font-medium max-w-[280px] leading-relaxed">Pilih salah satu rekaman di daftar sebelah kiri untuk melihat detail, timestamp, dan memotong klip bukti.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 pwa:p-5 border-b border-slate-100">
              <h2 className="text-[16px] pwa:text-[18px] font-bold text-[#1e293b]">Rekaman Penting</h2>
              <button className="text-blue-600 text-sm font-bold hover:underline">Lihat Semua</button>
            </div>

            <div className="p-4 pwa:p-5">
              {importantRecords.length === 0 ? (
                <div className="text-sm text-slate-500 font-medium">Belum ada rekaman penting pada rentang waktu ini.</div>
              ) : (
                <div className="flex overflow-x-auto hide-scrollbar gap-4 -mx-4 px-4 pwa:mx-0 pwa:px-0 pwa:overflow-visible pwa:grid pwa:grid-cols-4 lg:grid-cols-4">
                  {importantRecords.map((record) => (
                    <div key={`imp-${record.id}`} className="flex-shrink-0 w-[240px] pwa:w-auto flex flex-col gap-3">
                      <div onClick={() => selectRecord(record)} className="relative w-full aspect-video rounded-xl overflow-hidden group cursor-pointer">
                        <img src={record.image} alt={record.cameraName} className={cn("w-full h-full object-cover transition-transform group-hover:scale-105 duration-300", record.storageStatus === "unavailable" && "grayscale opacity-60")} />
                        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/40">
                            {record.storageStatus === "unavailable" ? <AlertTriangle className="w-3.5 h-3.5 text-white" /> : <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />}
                          </div>
                        </div>
                        <div className="absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-bold text-white">
                          {formatDuration(record.duration)}
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[13px] pwa:text-[15px] font-bold text-[#1e293b] truncate">{record.cameraName}</h3>
                          <p className="text-[11px] text-slate-500 mt-0.5">{formatRecordTime(record.startTime)}</p>
                        </div>
                        <button onClick={() => selectRecord(record)} className="px-3 py-1.5 text-blue-600 text-[11px] font-bold bg-white border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0">
                          Lihat
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedRecord && (
        <VideoTrimmerModal
          isOpen={isTrimmerOpen}
          onClose={() => setIsTrimmerOpen(false)}
          onExport={handleExportClip}
          recordData={{
            cameraName: selectedRecord.cameraName,
            date: formatRecordDate(selectedRecord.startTime),
            time: formatRecordTime(selectedRecord.startTime),
            thumbnail: selectedRecord.image,
          }}
          eventTime={selectedTime}
        />
      )}
    </div>
  );
}

function getSevenDayRange(anchor: Date) {
  const to = new Date(anchor);
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

function isPlaceholderThumbnail(url?: string | null) {
  return !url || url.includes("cam-placeholder");
}

function getRecordingImage(record: Recording, cameras: CameraType[], index: number) {
  if (record.thumbnailUrl && !isPlaceholderThumbnail(record.thumbnailUrl)) {
    return record.thumbnailUrl;
  }
  const camera = cameras.find((item) => item.id === record.cameraId);
  if (camera?.thumbnailUrl && !isPlaceholderThumbnail(camera.thumbnailUrl)) {
    return camera.thumbnailUrl;
  }
  return FALLBACK_THUMBNAILS[index % FALLBACK_THUMBNAILS.length];
}

function toDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatRecordDate(value: string) {
  return format(toDate(value), "d MMM yyyy", { locale: id });
}

function formatRecordTime(value: string) {
  return `${format(toDate(value), "HH:mm", { locale: id })} WIB`;
}

function toScrubberTime(value: string) {
  return format(toDate(value), "HH:mm", { locale: id });
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const rest = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function getStatusLabel(status: RecordingStatus) {
  const labels: Record<RecordingStatus, string> = {
    tersimpan: "Tersimpan",
    ditinjau: "Ditinjau",
    terkunci: "Terkunci",
  };
  return labels[status];
}

function getStatusStyle(status: RecordingStatus) {
  switch (status) {
    case "tersimpan":
      return "bg-emerald-50 text-emerald-600 border-emerald-100";
    case "ditinjau":
      return "bg-blue-50 text-blue-600 border-blue-100";
    case "terkunci":
      return "bg-purple-50 text-purple-600 border-purple-100";
    default:
      return "bg-slate-50 text-slate-600 border-slate-100";
  }
}

function getStatusIcon(status: RecordingStatus) {
  switch (status) {
    case "tersimpan":
    case "ditinjau":
      return <CheckCircle2 className="w-3.5 h-3.5" />;
    case "terkunci":
      return <Lock className="w-3.5 h-3.5" />;
    default:
      return null;
  }
}

function combineDateAndTime(baseIso: string, timeLabel: string) {
  const base = toDate(baseIso);
  const [hour = 0, minute = 0, second = 0] = timeLabel.split(":").map(Number);
  const next = new Date(base);
  next.setHours(hour, minute, second, 0);
  return next;
}
