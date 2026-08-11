"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
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
  MoreHorizontal,
  Pause,
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
import { DashboardPageHeader } from "@/components/layout/dashboard-page-header";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { TimelineScrubber } from "@/components/ui/timeline-scrubber";
import { RecordingPreview } from "@/components/recording/recording-preview";
import {
  VideoTrimmerModal,
  type VideoTrimExportPayload,
} from "@/components/ui/video-trimmer-modal";
import { useAuthStore } from "@/lib/stores/auth-store";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { getCameras } from "@/lib/api/cameras";
import { getBullyingLogs } from "@/lib/api/bullying-logs";
import {
  createEvidenceClip,
  downloadEvidenceClip,
  getRecordings,
  waitForEvidenceClip,
} from "@/lib/api/recordings";
import type { BullyingLog, Camera as CameraType, Recording } from "@/lib/types";


type TimelineMarker = {
  id: string;
  offsetSeconds: number;
  label: string;
  description: string;
};

export default function RekamanPage() {
  return (
    <Suspense fallback={<RekamanPageFallback />}>
      <RekamanPageContent />
    </Suspense>
  );
}

function RekamanPageContent() {
  const searchParams = useSearchParams();
  const queryCameraId = searchParams.get("cameraId");
  const queryLogId = searchParams.get("logId");
  const queryIncidentAt = searchParams.get("at");
  const queryIncidentKey = queryLogId
    ? `${queryLogId}|${queryIncidentAt ?? ""}`
    : null;
  const user = useAuthStore((state) => state.user);
  const canCreateClips = user?.role === "admin";
  const [records, setRecords] = useState<Recording[]>([]);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [logs, setLogs] = useState<BullyingLog[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedOffsetSeconds, setSelectedOffsetSeconds] = useState(0);
  const [isTrimmerOpen, setIsTrimmerOpen] = useState(false);
  const [fullscreenRecord, setFullscreenRecord] = useState<Recording | null>(null);
  const [date, setDate] = useState<Date | undefined>(() => {
    const incidentDate = queryIncidentAt ? new Date(queryIncidentAt) : null;
    return incidentDate && !Number.isNaN(incidentDate.getTime())
      ? incidentDate
      : new Date();
  });
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isLokasiOpen, setIsLokasiOpen] = useState(false);
  const [isKameraOpen, setIsKameraOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [selectedLokasi, setSelectedLokasi] = useState("all");
  const [selectedKamera, setSelectedKamera] = useState(queryCameraId ?? "all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const playbackVideoRef = useRef<HTMLVideoElement>(null);
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null);
  const playbackPositionsRef = useRef<Map<string, number>>(new Map());
  const handledIncidentRef = useRef<string | null>(null);
  const pendingIncidentRef = useRef<{
    key: string;
    recordId: string;
    offsetSeconds: number;
  } | null>(null);
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [fullscreenStartOffset, setFullscreenStartOffset] = useState(0);

  useEffect(() => {
    if (!fullscreenRecord) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreenRecord(null);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [fullscreenRecord]);

  useEffect(() => {
    if (!queryIncidentKey) return;
    const timeout = window.setTimeout(() => {
      if (queryCameraId) setSelectedKamera(queryCameraId);

      if (queryIncidentAt) {
        const incidentDate = new Date(queryIncidentAt);
        if (!Number.isNaN(incidentDate.getTime())) {
          setDate(incidentDate);
        }
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [queryCameraId, queryIncidentAt, queryIncidentKey]);

  const dateRange = useMemo(() => getSevenDayRange(date ?? new Date()), [date]);

  const loadRecordingData = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setErrorMessage("");
    }

    try {
      const [cameraResult, logResult, recordingResult] = await Promise.all([
        getCameras(),
        getBullyingLogs(),
        getRecordings({
          cameraId: selectedKamera === "all" ? undefined : selectedKamera,
          dateFrom: dateRange.from.toISOString(),
          dateTo: dateRange.to.toISOString(),
          search: searchTerm.trim() || undefined,
          limit: 200,
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
    } catch (error) {
      if (!silent) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Rekaman belum bisa dimuat. Coba lagi."
        );
        setRecords([]);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [dateRange.from, dateRange.to, searchTerm, selectedKamera]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadRecordingData();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadRecordingData]);

  useEffect(() => {
    const interval = window.setInterval(() => void loadRecordingData(true), 20000);
    return () => window.clearInterval(interval);
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


  const visibleRecords = useMemo(() => {
    if (selectedLokasi === "all") return records;
    return records.filter((record) => record.location === selectedLokasi);
  }, [records, selectedLokasi]);

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
        const resumeAt = playbackPositionsRef.current.get(selectedRecord.id) ?? 0;
        setSelectedRecordId(selectedRecord.id);
        setSelectedOffsetSeconds(resumeAt);
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectedRecord, selectedRecordId]);

  useEffect(() => {
    if (!queryIncidentKey || handledIncidentRef.current === queryIncidentKey) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const queriedLog = queryLogId
        ? logs.find((log) => log.id === queryLogId) ?? null
        : null;
      const incidentTimestamp = queriedLog?.timestamp ?? queryIncidentAt;
      const incidentCameraId = queriedLog?.cameraId ?? queryCameraId;
      if (!incidentTimestamp || !incidentCameraId) return;

      const incidentAt = new Date(incidentTimestamp).getTime();
      if (!Number.isFinite(incidentAt)) return;

      const matchingRecord = visibleRecords.find((record) => {
        const startTime = new Date(record.startTime).getTime();
        const endTime = new Date(record.endTime).getTime();
        return (
          record.cameraId === incidentCameraId
          && record.storageStatus === "available"
          && Boolean(record.playbackUrl)
          && startTime <= incidentAt
          && incidentAt <= endTime
        );
      });

      if (!matchingRecord) {
        setActionMessage(
          "Rekaman indikasi sedang diproses. Halaman akan memeriksa kembali secara otomatis.",
        );
        return;
      }

      const recordStart = new Date(matchingRecord.startTime).getTime();
      const offsetSeconds = Math.min(
        Math.max(0, (incidentAt - recordStart) / 1000),
        Math.max(1, matchingRecord.duration),
      );
      playbackPositionsRef.current.set(matchingRecord.id, offsetSeconds);
      if (selectedRecord?.id === matchingRecord.id) {
        handledIncidentRef.current = queryIncidentKey;
        setSelectedOffsetSeconds(offsetSeconds);
        setActionMessage("Rekaman indikasi ditemukan pada tanda merah.");
        setIsTrimmerOpen(true);
        return;
      }

      pendingIncidentRef.current = {
        key: queryIncidentKey,
        recordId: matchingRecord.id,
        offsetSeconds,
      };
      setSelectedRecordId(matchingRecord.id);
      setSelectedOffsetSeconds(offsetSeconds);
      setActionMessage("Rekaman indikasi ditemukan pada tanda merah.");
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [
    logs,
    queryCameraId,
    queryIncidentAt,
    queryIncidentKey,
    queryLogId,
    selectedRecord,
    visibleRecords,
  ]);

  useEffect(() => {
    const pendingIncident = pendingIncidentRef.current;
    if (!pendingIncident || selectedRecord?.id !== pendingIncident.recordId) return;

    playbackPositionsRef.current.set(
      pendingIncident.recordId,
      pendingIncident.offsetSeconds,
    );
    setSelectedOffsetSeconds(pendingIncident.offsetSeconds);
    handledIncidentRef.current = pendingIncident.key;
    pendingIncidentRef.current = null;
    setIsTrimmerOpen(true);
  }, [selectedRecord]);

  const incidentMarkers = useMemo(() => {
    return buildTimelineMarkers(selectedRecord, logs);
  }, [logs, selectedRecord]);

  const fullscreenIncidentMarkers = useMemo(
    () => buildTimelineMarkers(fullscreenRecord, logs),
    [fullscreenRecord, logs],
  );

  const selectedAvailable = selectedRecord?.storageStatus === "available";
  const availableRanges = useMemo(() => {
    if (!selectedRecord) return [];
    return [{
      id: selectedRecord.id,
      startOffsetSeconds: 0,
      endOffsetSeconds: Math.max(1, selectedRecord.duration),
      label:
        selectedRecord.cameraName
        + " "
        + formatRecordTime(selectedRecord.startTime),
    }];
  }, [selectedRecord]);

  const selectedDurationSeconds = Math.max(1, selectedRecord?.duration ?? 1);
  const selectedTimestamp = selectedRecord
    ? addSecondsToTimestamp(selectedRecord.startTime, selectedOffsetSeconds)
    : null;
  const selectedTimeLabel = selectedTimestamp
    ? format(selectedTimestamp, "HH:mm:ss", { locale: id })
    : "--:--:--";
  const selectedMomentLabel = selectedTimestamp
    ? format(selectedTimestamp, "d MMM yyyy HH:mm:ss", { locale: id })
    : "-";

  const selectedPlaybackId = selectedRecord?.id ?? null;
  const selectedPlaybackDuration = Math.max(1, selectedRecord?.duration ?? 1);

  useEffect(() => {
    const video = playbackVideoRef.current;
    if (!video || !selectedPlaybackId) return;

    const resumeAt = Math.min(
      Math.max(0, playbackPositionsRef.current.get(selectedPlaybackId) ?? 0),
      selectedPlaybackDuration,
    );
    setSelectedOffsetSeconds(resumeAt);
    setIsPlaybackPlaying(false);
    setPlaybackError("");
    video.pause();
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      video.currentTime = Math.min(resumeAt, Math.max(0, video.duration));
    }
  }, [selectedPlaybackDuration, selectedPlaybackId]);

  useEffect(() => {
    if (fullscreenRecord || !selectedPlaybackId) return;
    const video = playbackVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const resumeAt = playbackPositionsRef.current.get(selectedPlaybackId) ?? 0;
    video.currentTime = Math.min(resumeAt, Math.max(0, video.duration));
  }, [fullscreenRecord, selectedPlaybackId]);

  const handleTimelineTimeChange = (offsetSeconds: number) => {
    if (!selectedRecord) return;

    const boundedOffset = Math.min(
      Math.max(0, offsetSeconds),
      selectedDurationSeconds,
    );
    setSelectedOffsetSeconds(boundedOffset);
    playbackPositionsRef.current.set(selectedRecord.id, boundedOffset);

    const video = playbackVideoRef.current;
    if (!video) return;
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(boundedOffset, video.duration)
      : boundedOffset;
  };

  const handlePlaybackToggle = async () => {
    if (!selectedRecord?.playbackUrl || !selectedAvailable) return;
    const video = playbackVideoRef.current;
    if (!video) return;

    try {
      if (video.paused) {
        await video.play();
        setIsPlaybackPlaying(true);
      } else {
        video.pause();
        setIsPlaybackPlaying(false);
      }
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : "Playback rekaman belum bisa dimulai.");
    }
  };

  const selectRecord = (record: Recording, offsetSeconds?: number) => {
    if (selectedRecord && playbackVideoRef.current) {
      playbackPositionsRef.current.set(
        selectedRecord.id,
        playbackVideoRef.current.currentTime,
      );
    }
    const resumeAt = Math.min(
      Math.max(
        0,
        offsetSeconds ?? playbackPositionsRef.current.get(record.id) ?? 0,
      ),
      Math.max(1, record.duration),
    );
    playbackPositionsRef.current.set(record.id, resumeAt);
    setSelectedRecordId(record.id);
    setSelectedOffsetSeconds(resumeAt);
    setActionMessage("");
  };

  const openFullscreenViewer = (record: Recording) => {
    const currentDetailTime = selectedRecord?.id === record.id
      ? playbackVideoRef.current?.currentTime
      : undefined;
    const resumeAt = currentDetailTime
      ?? playbackPositionsRef.current.get(record.id)
      ?? 0;
    selectRecord(record, resumeAt);
    playbackVideoRef.current?.pause();
    setIsPlaybackPlaying(false);
    setPlaybackError("");

    if (record.storageStatus !== "available" || !record.playbackUrl) {
      setActionMessage("Rekaman ini belum tersedia untuk diputar.");
      return;
    }

    setFullscreenStartOffset(resumeAt);
    setFullscreenRecord(record);
  };

  const handleFullscreenTimeChange = (offsetSeconds: number) => {
    if (!fullscreenRecord) return;
    const boundedOffset = Math.min(
      Math.max(0, offsetSeconds),
      Math.max(1, fullscreenRecord.duration),
    );
    playbackPositionsRef.current.set(fullscreenRecord.id, boundedOffset);
    setSelectedOffsetSeconds(boundedOffset);
    const video = fullscreenVideoRef.current;
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      video.currentTime = Math.min(boundedOffset, Math.max(0, video.duration));
    }
  };

  const openTrimmer = (record?: Recording) => {
    const target = record ?? selectedRecord;
    if (!target) return;
    playbackVideoRef.current?.pause();
    setIsPlaybackPlaying(false);
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
      startTime: addSecondsToTimestamp(
        selectedRecord.startTime,
        payload.trimStart,
      ).toISOString(),
      endTime: addSecondsToTimestamp(
        selectedRecord.startTime,
        payload.trimEnd,
      ).toISOString(),
      reason: "recording_view_trim_export",
    });

    setActionMessage(`Klip ${clip.id} sedang dipotong oleh FFmpeg...`);
    const readyClip = await waitForEvidenceClip(selectedRecord.id, clip.id);
    downloadEvidenceClip(readyClip);
    setActionMessage(`Klip bukti ${readyClip.id} siap dan berhasil diunduh.`);
  };

  return (
    <div className="bg-[#f4f7fb] min-h-screen -m-4 p-4 pwa:-m-6 pwa:p-6 font-sans text-slate-900 pb-24 pwa:pb-6">
      <DashboardPageHeader
        title="Rekaman"
        description="Rekaman setiap sesi kamera, maksimal 24 jam dan tersedia selama 7 hari."
      />

      <div className="max-w-7xl mx-auto space-y-6">
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
                  (selectedLokasi !== "all" || selectedKamera !== "all")
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

            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="order-2 flex flex-col lg:order-1 lg:col-span-8">
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
                    <p className="text-[12px] pwa:text-[13px] text-slate-500 font-medium max-w-[320px]">
                      {queryIncidentKey
                        ? actionMessage || "Rekaman indikasi sedang diproses setelah kamera berhenti."
                        : "Rekaman akan muncul setelah kamera berhenti atau mencapai batas 24 jam."}
                    </p>
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
                        <RecordingPreview
                          src={record.playbackUrl}
                          label={record.cameraName}
                          unavailable={record.storageStatus === "unavailable"}
                        />
                        {record.hasIncident && (
                          <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-1 text-[9px] font-bold leading-none text-white shadow-md pwa:right-2 pwa:top-2 pwa:text-[10px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            {record.incidentCount} indikasi
                          </div>
                        )}
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
                          <div className={cn(
                            "hidden pwa:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold",
                            record.storageStatus === "unavailable"
                              ? "bg-slate-100 text-slate-600 border-slate-200"
                              : record.hasIncident
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-600 border-emerald-100",
                          )}>
                            {record.storageStatus === "unavailable" || record.hasIncident ? (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            {record.storageStatus === "unavailable"
                              ? "Tidak Tersedia"
                              : record.hasIncident
                                ? "Ada Indikasi"
                                : "Tersedia"}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            <button onClick={(event) => { event.stopPropagation(); openFullscreenViewer(record); }} className="px-2.5 sm:px-3 pwa:px-3 py-1 pwa:py-1.5 text-blue-600 font-semibold text-[11px] pwa:text-xs bg-white pwa:bg-blue-50 hover:bg-blue-50 pwa:hover:bg-blue-100 rounded-[6px] pwa:rounded-lg transition-colors border border-blue-200 pwa:border-blue-100">
                              Lihat
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

          <div className="order-1 flex flex-col lg:order-2 lg:col-span-4">
            <div className="bg-white rounded-2xl pwa:rounded-[24px] border border-slate-100 shadow-sm flex flex-col mb-6 lg:mb-0 overflow-hidden">
              <div className="px-4 py-3.5 pwa:px-5 pwa:py-5 border-b border-slate-100 mb-4 pwa:mb-5">
                <h2 className="text-[16px] pwa:text-[18px] font-bold text-[#1e293b]">Detail Rekaman Terpilih</h2>
              </div>

              <div className="px-4 pwa:px-5 pb-4 pwa:pb-5 flex flex-col flex-1">
                {selectedRecord ? (
                  <>
                    <div className="relative w-full aspect-video rounded-xl overflow-hidden mb-5 bg-black">
                      {selectedRecord.playbackUrl ? (
                        <video
                          ref={playbackVideoRef}
                          src={selectedRecord.playbackUrl}
                          className={cn("w-full h-full object-cover", !selectedAvailable && "grayscale opacity-40")}
                          playsInline
                          preload="metadata"
                          onPlay={() => setIsPlaybackPlaying(true)}
                          onPause={() => setIsPlaybackPlaying(false)}
                          onLoadedMetadata={(event) => {
                            const resumeAt = playbackPositionsRef.current.get(selectedRecord.id) ?? 0;
                            event.currentTarget.currentTime = Math.min(
                              resumeAt,
                              Math.max(0, event.currentTarget.duration),
                            );
                            setPlaybackError("");
                          }}
                          onError={() => setPlaybackError("File rekaman belum bisa diputar. Coba Muat Ulang atau pilih segment lain.")}
                          onTimeUpdate={(event) => {
                            const currentTime = event.currentTarget.currentTime;
                            playbackPositionsRef.current.set(selectedRecord.id, currentTime);
                            setSelectedOffsetSeconds(currentTime);
                          }}
                        />
                      ) : (
                        <RecordingPreview
                          src={selectedRecord.playbackUrl}
                          label={selectedRecord.cameraName}
                          unavailable={!selectedAvailable}
                          eager
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <button onClick={() => void handlePlaybackToggle()} disabled={!selectedAvailable || !selectedRecord.playbackUrl} className="w-12 h-12 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-white/20 hover:bg-black/80 transition-colors hover:scale-105 disabled:hover:scale-100 disabled:opacity-80">
                          {selectedAvailable ? (isPlaybackPlaying ? <Pause className="w-5 h-5 text-white fill-white" /> : <Play className="w-5 h-5 text-white fill-white ml-1" />) : <AlertTriangle className="w-5 h-5 text-white" />}
                        </button>
                      </div>
                      <div className={cn("absolute top-3 left-3 text-white px-2 py-0.5 rounded text-[10px] font-bold tracking-widest flex items-center gap-1.5", selectedAvailable ? "bg-slate-900/80" : "bg-amber-500")}>
                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        {selectedAvailable ? "REKAMAN" : "NVR/DVR ERROR"}
                      </div>
                      <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded flex items-center gap-1 text-[11px] font-bold text-white border border-white/20">
                        {selectedRecord.cameraName} - {selectedTimeLabel}
                      </div>
                      {playbackError && (
                        <div className="absolute inset-x-3 bottom-10 rounded-lg bg-red-950/85 px-3 py-2 text-center text-[11px] font-medium text-red-50 backdrop-blur-sm">
                          {playbackError}
                        </div>
                      )}
                    </div>
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-700">Timeline Rekaman</span>
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                          <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-1" />
                          Indikasi Bullying
                        </span>
                      </div>
                      {selectedAvailable ? (
                        <TimelineScrubber
                          durationSeconds={selectedDurationSeconds}
                          currentSeconds={selectedOffsetSeconds}
                          startTime={selectedRecord.startTime}
                          markers={incidentMarkers}
                          availableRanges={availableRanges}
                          onTimeChange={handleTimelineTimeChange}
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
                        <div className="flex-1 text-[13px] pwa:text-[14px] font-medium text-[#1e293b]">
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-600">
                            {selectedMomentLabel} WIB
                          </span>
                        </div>
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
                      {selectedRecord.expiresAt && (
                        <div className="flex items-start">
                          <div className="w-28 pwa:w-32 flex items-center gap-1.5 pwa:gap-2 text-slate-500 text-[11px] pwa:text-xs">
                            <CalendarIcon className="w-3.5 h-3.5 pwa:w-4 pwa:h-4" /> Tersedia Hingga
                          </div>
                          <div className="flex-1 text-[13px] pwa:text-[14px] font-medium text-[#1e293b]">
                            {formatRecordDate(selectedRecord.expiresAt)} {formatRecordTime(selectedRecord.expiresAt)}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2.5 mb-5">
                      {canCreateClips && (
                        <button
                          onClick={() => openTrimmer()}
                          disabled={!selectedAvailable}
                          className="w-full flex items-center justify-center gap-2 bg-[#1b64f2] hover:bg-blue-700 text-white py-3 rounded-xl font-bold text-sm transition-colors shadow-sm disabled:bg-slate-300 disabled:text-slate-500"
                        >
                          <Lock className="w-4 h-4" /> Potong & Simpan Klip ({selectedTimeLabel})
                        </button>
                      )}
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
                        {selectedAvailable ? "Rekaman telah dikompresi untuk pemutaran dan otomatis dihapus setelah masa simpan 7 hari berakhir." : "Arsip video tidak tersedia pada waktu ini. Muat ulang atau periksa penyimpanan server."}
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
            playbackUrl: selectedRecord.playbackUrl,
            duration: selectedRecord.duration,
            startTime: selectedRecord.startTime,
          }}
          eventTime={selectedTimestamp?.toISOString() ?? selectedRecord.startTime}
          canExport={canCreateClips}
        />
      )}

      {fullscreenRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Pemutar rekaman ${fullscreenRecord.cameraName}`}
          className="fixed inset-0 z-[100] flex flex-col bg-black"
        >
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-gradient-to-b from-black/90 to-transparent px-4 py-4 text-white sm:px-6">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold sm:text-base">
                {fullscreenRecord.cameraName}
              </h2>
              <p className="truncate text-xs text-white/70">
                {formatRecordDate(fullscreenRecord.startTime)} {formatRecordTime(fullscreenRecord.startTime)} · {fullscreenRecord.location}
              </p>
              {fullscreenIncidentMarkers.length > 0 && (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-1 text-[10px] font-bold text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  {fullscreenIncidentMarkers.length} indikasi
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFullscreenRecord(null)}
              aria-label="Tutup pemutar rekaman"
              className="flex size-10 flex-none items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="size-5" />
            </button>
          </div>

          <video
            key={fullscreenRecord.id}
            ref={fullscreenVideoRef}
            src={fullscreenRecord.playbackUrl ?? undefined}
            className="min-h-0 w-full flex-1 object-contain"
            controls
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              video.currentTime = Math.min(
                fullscreenStartOffset,
                Math.max(0, video.duration),
              );
              void video.play().catch(() => undefined);
            }}
            onTimeUpdate={(event) => {
              const currentTime = event.currentTarget.currentTime;
              playbackPositionsRef.current.set(fullscreenRecord.id, currentTime);
              setSelectedOffsetSeconds(currentTime);
            }}
            onError={() => {
              setPlaybackError("File rekaman belum bisa diputar. Coba Muat Ulang.");
            }}
          />

          <div className="z-10 flex-none border-t border-white/10 bg-slate-950 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
            <div className="mx-auto max-w-5xl">
              <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-300">
                <span>Timeline Rekaman</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Indikasi bullying
                </span>
              </div>
              <TimelineScrubber
                durationSeconds={Math.max(1, fullscreenRecord.duration)}
                currentSeconds={selectedOffsetSeconds}
                startTime={fullscreenRecord.startTime}
                markers={fullscreenIncidentMarkers}
                availableRanges={[{
                  id: fullscreenRecord.id,
                  startOffsetSeconds: 0,
                  endOffsetSeconds: Math.max(1, fullscreenRecord.duration),
                  label: fullscreenRecord.cameraName,
                }]}
                onTimeChange={handleFullscreenTimeChange}
              />
            </div>
          </div>

          {playbackError && (
            <div className="pointer-events-none absolute inset-x-4 bottom-28 z-20 mx-auto max-w-lg rounded-xl bg-red-950/90 px-4 py-3 text-center text-sm font-medium text-red-50">
              {playbackError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RekamanPageFallback() {
  return (
    <div className="-m-4 flex min-h-screen items-center justify-center bg-[#f4f7fb] p-4 text-sm font-semibold text-slate-500 pwa:-m-6 pwa:p-6">
      Memuat rekaman...
    </div>
  );
}

function buildTimelineMarkers(
  record: Recording | null,
  logs: BullyingLog[],
): TimelineMarker[] {
  if (!record) return [];
  const start = new Date(record.startTime).getTime();
  const end = new Date(record.endTime).getTime();

  return logs
    .filter((log) => {
      const timestamp = new Date(log.timestamp).getTime();
      return (
        log.cameraId === record.cameraId
        && timestamp >= start
        && timestamp <= end
      );
    })
    .map((log) => ({
      id: log.id,
      offsetSeconds: Math.max(
        0,
        (toDate(log.timestamp).getTime() - start) / 1000,
      ),
      label: formatRecordMoment(log.timestamp),
      description: log.title,
    }));
}

function getSevenDayRange(anchor: Date) {
  const to = new Date(anchor);
  to.setHours(23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to };
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

function formatRecordMoment(value: string) {
  return format(toDate(value), "d MMM yyyy HH:mm:ss", { locale: id });
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

function addSecondsToTimestamp(baseIso: string, seconds: number) {
  const base = toDate(baseIso);
  return new Date(base.getTime() + Math.max(0, seconds) * 1000);
}
