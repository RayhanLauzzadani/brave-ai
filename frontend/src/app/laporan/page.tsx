"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import {
  AlertTriangle,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  MapPin,
  Menu,
  MessageCircle,
  Play,
  RefreshCw,
  Search,
  SearchX,
  FileText,
  ShieldCheck,
  Tag,
  TriangleAlert,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { MobileSidebar } from "@/components/layout/mobile-nav";
import { getBullyingLogs, updateBullyingLogStatus } from "@/lib/api/bullying-logs";
import { getCameras } from "@/lib/api/cameras";
import { getEvidenceClips, getRecordings } from "@/lib/api/recordings";
import type { BullyType, BullyingLog, Camera as CameraType, EvidenceClipResponse, LogStatus, Recording } from "@/lib/types";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: Array<{ value: "all" | LogStatus; label: string }> = [
  { value: "all", label: "Semua Status" },
  { value: "dalam-proses", label: "Dalam Proses" },
  { value: "ditinjau", label: "Ditinjau" },
  { value: "selesai", label: "Selesai" },
  { value: "prioritas-tinggi", label: "Prioritas Tinggi" },
];

const KATEGORI_OPTIONS: Array<{ value: "all" | BullyType; label: string }> = [
  { value: "all", label: "Semua Kategori" },
  { value: "physical", label: "Bullying Fisik" },
  { value: "verbal", label: "Bullying Verbal" },
  { value: "social", label: "Bullying Sosial" },
  { value: "unknown", label: "Belum Dikategorikan" },
];

const FALLBACK_THUMBNAILS = [
  "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1590402494682-cd3fb53b1f70?q=80&w=900&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=900&auto=format&fit=crop",
];

export default function LaporanPage() {
  return (
    <Suspense fallback={<div className="bg-[#f4f7fb] min-h-screen -m-4 p-4 pwa:-m-6 pwa:p-6 text-sm font-semibold text-slate-500">Memuat laporan...</div>}>
      <LaporanContent />
    </Suspense>
  );
}

function LaporanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryRecordingId = searchParams.get("recordingId");
  const queryLogId = searchParams.get("logId");

  const unreadCount = useAlertStore((s) => s.unreadCount);
  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);

  const [logs, setLogs] = useState<BullyingLog[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [evidenceClipsByRecordingId, setEvidenceClipsByRecordingId] = useState<Record<string, EvidenceClipResponse[]>>({});
  const [selectedLogId, setSelectedLogId] = useState<string | null>(queryLogId);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isLokasiOpen, setIsLokasiOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [isKategoriOpen, setIsKategoriOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [selectedLokasi, setSelectedLokasi] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | LogStatus>("all");
  const [selectedKategori, setSelectedKategori] = useState<"all" | BullyType>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [isLoadingEvidenceClips, setIsLoadingEvidenceClips] = useState(false);
  const [evidenceClipError, setEvidenceClipError] = useState("");

  const dateRange = useMemo(() => (date ? getDayRange(date) : null), [date]);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const [cameraResult, recordingResult, logResult] = await Promise.all([
        getCameras(),
        getRecordings({ hasIncident: true }),
        getBullyingLogs({
          status: selectedStatus,
          bullyType: selectedKategori,
          recordingId: queryRecordingId ?? undefined,
          dateFrom: dateRange?.from.toISOString(),
          dateTo: dateRange?.to.toISOString(),
          search: searchTerm.trim() || undefined,
        }),
      ]);

      setCameras(cameraResult);
      setRecordings(recordingResult);
      setLogs(logResult);
      setSelectedLogId((current) => {
        if (queryLogId && logResult.some((log) => log.id === queryLogId)) return queryLogId;
        if (current && logResult.some((log) => log.id === current)) return current;
        return logResult[0]?.id ?? null;
      });
    } catch (error) {
      setLogs([]);
      setErrorMessage(error instanceof Error ? error.message : "Laporan belum bisa dimuat.");
    } finally {
      setIsLoading(false);
    }
  }, [dateRange, queryLogId, queryRecordingId, searchTerm, selectedKategori, selectedStatus]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadReports();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadReports]);

  const lokasiOptions = useMemo(() => {
    const locations = Array.from(new Set(cameras.map((camera) => camera.location))).sort();
    return [
      { value: "all", label: "Semua Lokasi" },
      ...locations.map((location) => ({ value: location, label: location })),
    ];
  }, [cameras]);

  const logsWithContext = useMemo(
    () =>
      logs.map((log, index) => {
        const camera = cameras.find((item) => item.id === log.cameraId);
        const recording = recordings.find((item) => item.id === log.recordingId);
        return {
          ...log,
          location: camera?.location ?? recording?.location ?? "Area kamera",
          recording,
          image: getLogImage(log, recording, index),
        };
      }),
    [cameras, logs, recordings]
  );

  const visibleLogs = useMemo(() => {
    if (selectedLokasi === "all") return logsWithContext;
    return logsWithContext.filter((log) => log.location === selectedLokasi);
  }, [logsWithContext, selectedLokasi]);

  const selectedLog = useMemo(
    () => visibleLogs.find((log) => log.id === selectedLogId) ?? visibleLogs[0] ?? null,
    [selectedLogId, visibleLogs]
  );
  const selectedRecordingId = selectedLog?.recordingId ?? null;
  const selectedEvidenceClips = selectedRecordingId
    ? evidenceClipsByRecordingId[selectedRecordingId] ?? []
    : [];
  const selectedEvidenceClip = selectedEvidenceClips[0] ?? null;
  const selectedRecordingUnavailable = selectedLog?.recording?.storageStatus === "unavailable";
  const isSelectedEvidenceLoading = !!selectedRecordingId && isLoadingEvidenceClips;
  const selectedEvidenceClipError = selectedRecordingId ? evidenceClipError : "";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!selectedLog) {
        setSelectedLogId(null);
        return;
      }
      if (selectedLog.id !== selectedLogId) {
        setSelectedLogId(selectedLog.id);
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectedLog, selectedLogId]);

  useEffect(() => {
    if (!selectedRecordingId) return;

    let cancelled = false;
    let refreshTimer: number | null = null;

    const loadClips = async (showLoading: boolean) => {
      if (showLoading) setIsLoadingEvidenceClips(true);
      setEvidenceClipError("");

      try {
        const clips = await getEvidenceClips(selectedRecordingId);
        if (cancelled) return;

        setEvidenceClipsByRecordingId((current) => ({
          ...current,
          [selectedRecordingId]: clips,
        }));

        if (clips.some((clip) => clip.status === "queued" || clip.status === "processing")) {
          refreshTimer = window.setTimeout(() => void loadClips(false), 2_000);
        }
      } catch (error) {
        if (!cancelled) {
          setEvidenceClipError(
            error instanceof Error ? error.message : "Clip bukti belum bisa dimuat."
          );
        }
      } finally {
        if (!cancelled && showLoading) setIsLoadingEvidenceClips(false);
      }
    };

    void loadClips(true);

    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [selectedRecordingId]);

  const updateStatus = async (status: LogStatus) => {
    if (!selectedLog) return;
    setActionMessage("");
    setActionError("");

    try {
      const updated = await updateBullyingLogStatus(selectedLog.id, status);
      setLogs((current) => current.map((log) => (log.id === updated.id ? updated : log)));
      setSelectedLogId(updated.id);
      setActionMessage(`Status laporan diperbarui menjadi ${getStatusLabel(updated.status)}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Status laporan gagal diperbarui.");
    }
  };

  const cycleStatus = () => {
    if (!selectedLog) return;
    const nextStatus: LogStatus =
      selectedLog.status === "dalam-proses"
        ? "ditinjau"
        : selectedLog.status === "ditinjau"
          ? "selesai"
          : selectedLog.status === "prioritas-tinggi"
            ? "ditinjau"
            : "selesai";
    void updateStatus(nextStatus);
  };

  const openEvidence = () => {
    if (!selectedLog?.recordingId) return;
    router.push(`/rekaman?recordingId=${encodeURIComponent(selectedLog.recordingId)}`);
  };
  return (
    <div className="bg-[#f4f7fb] min-h-screen -m-4 p-4 pwa:-m-6 pwa:p-6 font-sans text-slate-900 pb-24 pwa:pb-6">
      {/* Mobile Top Bar with Title */}
      <div className="flex lg:hidden items-center justify-between -mx-4 -mt-4 pwa:-mx-6 pwa:-mt-6 mb-6 px-4 py-3 pwa:px-6 pwa:py-4 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm sticky top-0 z-50 transform-gpu">
        {/* Hamburger Menu (only visible on tablet, 501px - 1023px) */}
        <div className="hidden pwa:flex items-center">
          <Sheet>
            <SheetTrigger render={<button className="p-2 -ml-2 rounded-lg hover:bg-slate-100 transition-colors focus:outline-none" />}>
              <Menu className="w-6 h-6 text-[#1e293b]" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 bg-[#064eb7] border-white/[0.06] text-white">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <MobileSidebar />
            </SheetContent>
          </Sheet>
        </div>

        {/* Title for mobile inline with header */}
        <div className="flex flex-col flex-1 min-w-0 pr-4">
          <h1 className="text-[18px] pwa:text-[20px] font-bold text-[#0f172a] tracking-tight leading-none">Laporan Bullying</h1>
          <p className="text-[11px] font-desc text-slate-500 truncate mt-0.5">
            Kelola, tinjau, dan tindak lanjuti laporan kejadian bullying secara terstruktur.
          </p>
        </div>

        <button className="relative p-2 rounded-full hover:bg-slate-100 transition-colors flex-shrink-0">
          <Bell className="w-6 h-6 text-[#1e293b]" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
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
            <h2 className="text-[15px] font-bold text-[#0f172a]">Laporan Bullying</h2>
            <p className="text-[11px] font-desc text-slate-500 -mt-0.5">Kelola, tinjau, dan tindak lanjuti laporan kejadian bullying secara terstruktur.</p>
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

        {/* Filter Bar */}
        <div className="flex flex-col gap-3 pwa:flex-row pwa:gap-4 mb-6">
          {/* Search Bar — pill shape on mobile, standard on tablet+ */}
          <div className="relative flex-1">
            <Search className="w-[18px] h-[18px] pwa:w-5 pwa:h-5 text-slate-400 absolute left-3.5 pwa:left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Cari nama, lokasi, atau kata kunci..."
              className="w-full pl-10 pwa:pl-10 pr-4 py-2.5 pwa:py-2.5 bg-white rounded-full pwa:rounded-xl border border-slate-200/60 pwa:border-slate-200 text-[13px] pwa:text-sm outline-none focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 pwa:focus:border-blue-500 pwa:focus:ring-1 pwa:focus:ring-blue-500 transition-all placeholder:text-slate-400 pwa:shadow-sm"
            />
          </div>
          {/* Filter Chips — horizontal scroll chips on mobile, dropdown on tablet+ */}
          <div className="flex overflow-x-auto hide-scrollbar gap-2 pb-0.5 pwa:pb-0 pwa:items-center -mx-1 px-1 pwa:mx-0 pwa:px-0">
            {/* 1. Date Filter: Always visible on mobile and desktop */}
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger className={cn(
                "flex shrink-0 items-center gap-1.5 px-3.5 py-[7px] pwa:px-4 pwa:py-2.5 rounded-full pwa:rounded-xl text-[12px] pwa:text-sm font-semibold pwa:font-medium whitespace-nowrap transition-all",
                date
                  ? "bg-blue-50 text-[#064eb7] border border-blue-200 pwa:bg-white pwa:text-slate-700 pwa:border-slate-200 pwa:shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200/60 pwa:bg-white pwa:text-slate-500 pwa:border-slate-200 pwa:shadow-sm"
              )}>
                <Calendar className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" />
                {date ? format(date, "d MMM yyyy", { locale: idLocale }) : <span>Tanggal</span>}
                <ChevronDown className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 opacity-50" />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-white border border-slate-200 shadow-lg rounded-xl text-slate-800" align="start">
                <div className="[&_[data-selected-single=true]]:!bg-[#1b64f2] [&_[data-selected-single=true]]:!text-white [&_.bg-muted]:!bg-slate-100 [&_.text-muted-foreground]:!text-slate-500 [&_.hover\:bg-accent]:hover:!bg-slate-50">
                  <CalendarComponent
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
                  (selectedLokasi !== "all" || selectedStatus !== "all" || selectedKategori !== "all")
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
                        setSelectedKategori("all");
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

                    {/* Kategori */}
                    <div>
                      <h3 className="text-[13px] font-bold text-[#0f172a] uppercase tracking-wide mb-3">Kategori</h3>
                      <div className="flex flex-wrap gap-2">
                        {KATEGORI_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setSelectedKategori(opt.value)}
                            className={cn(
                              "px-4 py-2 rounded-full text-[13px] font-medium transition-all border",
                              selectedKategori === opt.value
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
                  <MapPin className="w-4 h-4" />
                  {lokasiOptions.find((option) => option.value === selectedLokasi)?.label ?? "Lokasi"}
                  <ChevronDown className="w-4 h-4 opacity-60" />
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

              <Popover open={isStatusOpen} onOpenChange={setIsStatusOpen}>
                <PopoverTrigger className={cn(
                  "flex shrink-0 items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors",
                  selectedStatus !== "all"
                    ? "bg-white text-slate-700 border-slate-200 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 shadow-sm border"
                )}>
                  <ShieldCheck className="w-4 h-4" />
                  {STATUS_OPTIONS.find((option) => option.value === selectedStatus)?.label ?? "Status"}
                  <ChevronDown className="w-4 h-4 opacity-60" />
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

              <Popover open={isKategoriOpen} onOpenChange={setIsKategoriOpen}>
                <PopoverTrigger className={cn(
                  "flex shrink-0 items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors",
                  selectedKategori !== "all"
                    ? "bg-white text-slate-700 border-slate-200 shadow-sm"
                    : "bg-white text-slate-700 border-slate-200 shadow-sm border"
                )}>
                  <Tag className="w-4 h-4" />
                  {KATEGORI_OPTIONS.find((option) => option.value === selectedKategori)?.label ?? "Kategori"}
                  <ChevronDown className="w-4 h-4 opacity-60" />
                </PopoverTrigger>
                <PopoverContent className="w-auto min-w-[180px] p-1.5 bg-white border border-slate-200 shadow-lg rounded-xl" align="start">
                  {KATEGORI_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setSelectedKategori(option.value); setIsKategoriOpen(false); }}
                      className={cn(
                        "flex items-center justify-between w-full px-3 py-2 text-sm rounded-lg transition-colors text-left",
                        selectedKategori === option.value ? "bg-blue-50 text-blue-700 font-semibold" : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {option.label}
                      {selectedKategori === option.value && <Check className="w-4 h-4 text-blue-600 ml-3" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 flex flex-col gap-6">
            <div className="bg-white rounded-2xl pwa:rounded-[24px] border border-slate-100 shadow-sm overflow-hidden flex-1">
              <div className="flex items-center justify-between px-5 pwa:px-6 py-4 pwa:py-5">
                <h2 className="text-[16px] pwa:text-[18px] font-bold text-[#1e293b]">Daftar Laporan</h2>
                <button onClick={() => void loadReports()} className="flex items-center gap-1.5 text-[12px] pwa:text-[13px] font-bold text-blue-500 cursor-pointer hover:text-blue-600 transition-colors">
                  <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
                  Muat Ulang
                </button>
              </div>

              <div className="flex flex-col px-3 pwa:px-4 pb-4">
                {errorMessage ? (
                  <div className="p-4 rounded-xl border border-red-100 bg-red-50 text-red-700 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">Laporan gagal dimuat</p>
                      <p className="text-xs mt-1 leading-relaxed">{errorMessage}</p>
                      <button onClick={() => void loadReports()} className="mt-3 px-3 py-1.5 text-xs font-bold bg-white border border-red-200 rounded-lg hover:bg-red-100 transition-colors">Coba Lagi</button>
                    </div>
                  </div>
                ) : isLoading ? (
                  <div className="p-4 text-sm text-slate-500 font-medium">Memuat laporan kejadian...</div>
                ) : visibleLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-4">
                      <SearchX className="w-7 h-7 text-slate-400" />
                    </div>
                    <h3 className="text-[14px] pwa:text-[15px] font-bold text-[#1e293b] mb-1.5">Tidak ada laporan</h3>
                    <p className="text-[12px] pwa:text-[13px] text-slate-500 font-medium max-w-[280px]">Belum ada laporan kejadian yang sesuai dengan filter yang dipilih.</p>
                  </div>
                ) : (                  visibleLogs.map((log, index) => {
                    const isSelected = selectedLog?.id === log.id;
                    const statusMeta = getStatusMeta(log.status);
                    const categoryLabel = getCategoryLabel(log.bullyType);
                    const containerClass = isSelected
                      ? "bg-[#f8faff] border border-blue-400 shadow-sm rounded-[16px]"
                      : `bg-transparent border-transparent hover:bg-slate-50/50 rounded-[16px] ${index !== visibleLogs.length - 1 && !isSelected ? "border-b-slate-100 rounded-b-none" : ""}`;

                    return (
                      <div
                        key={log.id}
                        onClick={() => setSelectedLogId(log.id)}
                        className={`flex items-center justify-between p-3 pwa:p-4 cursor-pointer transition-all ${containerClass}`}
                        style={!isSelected && index !== visibleLogs.length - 1 ? { borderBottomWidth: "1px" } : {}}
                      >
                        <div className="flex items-center gap-3 pwa:gap-4 flex-1 min-w-0">
                          <div className={`w-10 h-10 pwa:w-12 pwa:h-12 rounded-[12px] pwa:rounded-[14px] flex items-center justify-center flex-shrink-0 ${statusMeta.iconBg}`}>
                            {statusMeta.icon}
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5 ml-1">
                            <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-0.5">
                              {formatDateTime(log.timestamp)} WIB
                            </p>
                            <h3 className="text-[13px] pwa:text-[14px] font-bold text-[#1e293b] truncate">
                              {log.cameraName}
                            </h3>
                            <p className="text-[10px] pwa:text-[11px] text-slate-500 truncate mt-0.5 hidden pwa:block">
                              {categoryLabel} / {log.location}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 pwa:gap-4 ml-2 flex-shrink-0">
                          <div className={`px-2.5 py-1 text-[11px] font-bold rounded-md ${statusMeta.badge}`}>
                            {statusMeta.label}
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#1e293b]" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="hidden pwa:flex items-center justify-between p-4 pwa:p-5 border-t border-slate-100">
                <div className="flex items-center gap-1.5">
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" disabled>
                    <span className="sr-only">Previous</span>
                    &lt;
                  </button>
                  <button className="w-8 h-8 rounded-lg bg-blue-600 text-white font-medium text-[13px] flex items-center justify-center shadow-sm">
                    1
                  </button>
                  <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" disabled>
                    <span className="sr-only">Next</span>
                    &gt;
                  </button>
                </div>
                <div className="text-[12px] font-medium text-slate-500 hidden sm:block">
                  {visibleLogs.length} dari {logs.length} laporan
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col">
            <div className="bg-white rounded-2xl pwa:rounded-[24px] border border-slate-100 shadow-sm overflow-hidden sticky top-24">
              <div className="p-5 pwa:p-6 flex flex-col gap-5 pwa:gap-6">
                <h2 className="text-[16px] pwa:text-[18px] font-bold text-[#1e293b]">Laporan Terpilih</h2>

                {selectedLog ? (
                  <>
                    <div className="flex flex-row gap-3 pwa:gap-5">
                      <div className="w-[130px] pwa:w-[180px] h-[100px] pwa:h-[120px] rounded-[12px] pwa:rounded-xl overflow-hidden relative flex-shrink-0 bg-slate-100">
                        <img src={selectedLog.image} alt="Thumbnail" className="w-full h-full object-cover" />
                        <div className="absolute bottom-1.5 right-1.5 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-bold text-white">
                          {selectedLog.recording ? formatDuration(selectedLog.recording.duration) : "Bukti"}
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col pt-1">
                        <h3 className="text-[13px] pwa:text-[18px] font-bold text-[#1e293b] leading-tight mb-2 pwa:mb-4">{selectedLog.title}</h3>
                        <div className="flex flex-col gap-2 pwa:gap-3">
                          <p className="text-[11px] pwa:text-[13px] text-slate-500 font-medium">
                            {selectedLog.cameraName} <span className="mx-1">/</span> {formatDateTime(selectedLog.timestamp)} WIB
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] pwa:text-[13px] text-slate-500 font-medium">Status</span>
                            <span className={`px-2.5 py-1 rounded-md border font-bold text-[10px] pwa:text-[11px] ${getStatusMeta(selectedLog.status).badge}`}>{getStatusLabel(selectedLog.status)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-[12px] pwa:text-[13px] text-slate-500 leading-relaxed font-medium">
                        {selectedLog.description}
                      </p>
                    </div>

                    <button onClick={openEvidence} disabled={!selectedLog.recordingId} className="w-full flex items-center gap-3 bg-[#f8faff] text-blue-600 border border-blue-100 px-4 py-2.5 rounded-[10px] pwa:rounded-xl text-[12px] pwa:text-[13px] font-bold transition-colors disabled:text-slate-400 disabled:border-slate-100">
                      <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shadow-sm">
                        <Play className="w-2.5 h-2.5 fill-blue-600 text-blue-600 ml-0.5" />
                      </div>
                      {selectedLog.terkaitRekaman}
                    </button>

                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[12px] pwa:text-[13px] font-bold text-[#1e293b]">Bukti Clip</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">Potongan 30 detik sebelum dan sesudah kejadian.</p>
                        </div>
                        {selectedEvidenceClip && (
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${getClipStatusMeta(selectedEvidenceClip.status).badge}`}>
                            {getClipStatusMeta(selectedEvidenceClip.status).label}
                          </span>
                        )}
                      </div>

                      {selectedRecordingUnavailable ? (
                        <div className="mt-3 rounded-lg border border-red-100 bg-white p-3 text-[11px] font-medium leading-relaxed text-red-700">
                          Rekaman terkait tidak tersedia dari NVR/DVR, jadi clip bukti belum bisa dibuat dari waktu ini.
                        </div>
                      ) : isSelectedEvidenceLoading ? (
                        <div className="mt-3 rounded-lg border border-slate-100 bg-white p-3 text-[11px] font-medium text-slate-500">
                          Memuat clip bukti...
                        </div>
                      ) : selectedEvidenceClipError ? (
                        <div className="mt-3 rounded-lg border border-red-100 bg-white p-3 text-[11px] font-medium leading-relaxed text-red-700">
                          {selectedEvidenceClipError}
                        </div>
                      ) : selectedEvidenceClip ? (
                        <div className="mt-3 grid gap-2 text-[11px] pwa:text-[12px]">
                          <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 border border-slate-100">
                            <span className="font-medium text-slate-500">ID Clip</span>
                            <span className="font-bold text-[#1e293b] truncate">{selectedEvidenceClip.id}</span>
                          </div>
                          <div className="rounded-lg bg-white px-3 py-2 border border-slate-100">
                            <p className="font-medium text-slate-500">Rentang Bukti</p>
                            <p className="font-bold text-[#1e293b] mt-1">{formatClipRange(selectedEvidenceClip.startTime, selectedEvidenceClip.endTime)} WIB</p>
                          </div>
                          <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 border border-slate-100">
                            <span className="font-medium text-slate-500">Sumber</span>
                            <span className="font-bold text-[#1e293b] truncate">{getEvidenceReasonLabel(selectedEvidenceClip.reason)}</span>
                          </div>
                          {selectedEvidenceClip.status === "ready" && (
                            <a
                              href={selectedEvidenceClip.clipUrl}
                              download={`brave-ai-${selectedEvidenceClip.id}.mp4`}
                              className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 font-bold text-white transition-colors hover:bg-blue-700"
                            >
                              <Download className="h-4 w-4" />
                              Unduh MP4
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 text-[11px] font-medium leading-relaxed text-slate-600">
                          Belum ada clip bukti permanen untuk laporan ini. Klik aktivitas di Live Camera atau potong dari halaman Rekaman untuk membuatnya.
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-[11px] pwa:text-[12px]">
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <p className="text-slate-500 font-medium">Kategori</p>
                        <p className="font-bold text-[#1e293b] mt-1">{getCategoryLabel(selectedLog.bullyType)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <p className="text-slate-500 font-medium">Confidence</p>
                        <p className="font-bold text-[#1e293b] mt-1">{Math.round(selectedLog.confidence * 100)}%</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <p className="text-slate-500 font-medium">Pelapor</p>
                        <p className="font-bold text-[#1e293b] mt-1 truncate">{selectedLog.pelapor}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                        <p className="text-slate-500 font-medium">Lokasi</p>
                        <p className="font-bold text-[#1e293b] mt-1 truncate">{selectedLog.location}</p>
                      </div>
                    </div>

                    <div className="flex gap-1.5 pwa:grid pwa:grid-cols-2 pwa:gap-3">
                      <button onClick={openEvidence} disabled={!selectedLog.recordingId} className="flex-[1.3] pwa:col-span-2 flex items-center justify-center gap-1.5 bg-[#0e59f2] hover:bg-blue-700 text-white px-1.5 py-2 pwa:py-3 rounded-[8px] pwa:rounded-xl text-[11px] pwa:text-[13px] font-bold shadow-sm transition-colors disabled:bg-slate-300 disabled:text-slate-500">
                        <Eye className="w-4 h-4 flex-shrink-0" />
                        <span className="whitespace-nowrap">Tinjau Bukti</span>
                      </button>
                      <button onClick={cycleStatus} className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-blue-200 hover:bg-slate-50 text-blue-600 px-1.5 py-2 pwa:py-3 rounded-[8px] pwa:rounded-xl text-[11px] pwa:text-[13px] font-bold transition-colors">
                        <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                        <span>Status</span>
                      </button>
                      <button onClick={() => void updateStatus("selesai")} className="flex-[1.2] flex items-center justify-center gap-1.5 bg-[#f4eaff] hover:bg-[#ebdcf8] text-[#7c26f0] px-1.5 py-2 pwa:py-3 rounded-[8px] pwa:rounded-xl text-[11px] pwa:text-[13px] font-bold transition-colors">
                        <ClipboardList className="w-4 h-4 flex-shrink-0" />
                        <span className="leading-[1.15] text-left pwa:whitespace-nowrap">
                          Tindak<br className="block pwa:hidden" /> Lanjut
                        </span>
                      </button>
                    </div>

                    {actionMessage && (
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 flex items-start gap-3">
                        <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-800 leading-relaxed font-medium">{actionMessage}</p>
                      </div>
                    )}

                    {actionError && (
                      <div className="rounded-xl border border-red-100 bg-red-50 p-3 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-red-800 leading-relaxed font-medium">{actionError}</p>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <h3 className="text-[12px] pwa:text-[13px] font-bold text-[#1e293b] mb-3">Timeline Penanganan</h3>
                      <div className="space-y-3">
                        {selectedLog.timeline.map((item, index) => (
                          <div key={`${item.title}-${item.timestamp}-${index}`} className="flex gap-3">
                            <div className={cn("w-2.5 h-2.5 mt-1.5 rounded-full flex-shrink-0", item.status === "completed" ? "bg-emerald-500" : item.status === "current" ? "bg-blue-500" : "bg-slate-300")} />
                            <div className="min-w-0">
                              <p className="text-[12px] font-bold text-[#1e293b]">{item.title}</p>
                              <p className="text-[11px] text-slate-500 leading-relaxed">{item.description}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">{formatDateTime(item.timestamp)} WIB</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center">
                    <div className="w-20 h-20 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-5">
                      <FileText className="w-9 h-9 text-slate-400" />
                    </div>
                    <h3 className="text-[15px] pwa:text-[16px] font-bold text-[#1e293b] mb-2">Pilih Laporan</h3>
                    <p className="text-[13px] pwa:text-[14px] text-slate-500 font-medium max-w-[280px] leading-relaxed">Pilih salah satu laporan di daftar sebelah kiri untuk melihat detail kejadian, bukti rekaman, dan timeline penanganan.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function getDayRange(date: Date) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);

  const to = new Date(date);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

function getLogImage(log: BullyingLog, recording: Recording | undefined, index: number) {
  return log.thumbnailUrl ?? recording?.thumbnailUrl ?? FALLBACK_THUMBNAILS[index % FALLBACK_THUMBNAILS.length];
}

function formatDateTime(value: string) {
  return format(new Date(value), "dd MMM yyyy HH:mm", { locale: idLocale });
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getStatusLabel(status: LogStatus) {
  switch (status) {
    case "dalam-proses":
      return "Dalam Proses";
    case "ditinjau":
      return "Ditinjau";
    case "selesai":
      return "Selesai";
    case "prioritas-tinggi":
      return "Prioritas Tinggi";
    default:
      return "Status";
  }
}

function getClipStatusMeta(status: EvidenceClipResponse["status"]) {
  switch (status) {
    case "ready":
      return {
        label: "Siap",
        badge: "bg-emerald-50 text-emerald-700 border border-emerald-100",
      };
    case "processing":
      return {
        label: "Diproses",
        badge: "bg-blue-50 text-blue-700 border border-blue-100",
      };
    case "failed":
      return {
        label: "Gagal",
        badge: "bg-red-50 text-red-700 border border-red-100",
      };
    case "queued":
      return {
        label: "Queued",
        badge: "bg-amber-50 text-amber-700 border border-amber-100",
      };
    default:
      return {
        label: "Clip",
        badge: "bg-slate-50 text-slate-600 border border-slate-100",
      };
  }
}

function formatClipRange(startTime: string, endTime: string) {
  return `${format(new Date(startTime), "HH:mm:ss", { locale: idLocale })} - ${format(new Date(endTime), "HH:mm:ss", { locale: idLocale })}`;
}

function getEvidenceReasonLabel(reason: string) {
  switch (reason) {
    case "activity_incident_quick_clip":
      return "Aktivitas Live Camera";
    case "manual_live_view_save":
      return "Simpan Rekaman Live";
    case "ai_incident_seed":
      return "Demo AI Trigger";
    case "recording_view_export":
      return "Potong dari Rekaman";
    default:
      return "Evidence Clip";
  }
}
function getStatusMeta(status: LogStatus) {
  switch (status) {
    case "dalam-proses":
      return {
        label: "Proses",
        badge: "bg-amber-50 text-amber-700 border border-amber-100",
        iconBg: "bg-amber-50 text-amber-600",
        icon: <MessageCircle className="w-5 h-5" />,
      };
    case "ditinjau":
      return {
        label: "Ditinjau",
        badge: "bg-blue-50 text-blue-700 border border-blue-100",
        iconBg: "bg-blue-50 text-blue-600",
        icon: <Eye className="w-5 h-5" />,
      };
    case "selesai":
      return {
        label: "Selesai",
        badge: "bg-emerald-50 text-emerald-700 border border-emerald-100",
        iconBg: "bg-emerald-50 text-emerald-600",
        icon: <ShieldCheck className="w-5 h-5" />,
      };
    case "prioritas-tinggi":
      return {
        label: "Prioritas",
        badge: "bg-rose-50 text-rose-700 border border-rose-100",
        iconBg: "bg-rose-50 text-rose-600",
        icon: <TriangleAlert className="w-5 h-5" />,
      };
    default:
      return {
        label: "Status",
        badge: "bg-slate-50 text-slate-600 border border-slate-100",
        iconBg: "bg-slate-50 text-slate-600",
        icon: <ClipboardList className="w-5 h-5" />,
      };
  }
}

function getCategoryLabel(type: BullyType) {
  switch (type) {
    case "physical":
      return "Bullying Fisik";
    case "verbal":
      return "Bullying Verbal";
    case "social":
      return "Bullying Sosial";
    case "unknown":
      return "Belum Dikategorikan";
    default:
      return "Kategori";
  }
}
