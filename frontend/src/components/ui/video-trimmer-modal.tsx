"use client";

import React, {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Play, Pause, Scissors, Download, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VideoTrimExportPayload {
  trimStart: number;
  trimEnd: number;
  duration: number;
  startLabel: string;
  endLabel: string;
}

interface VideoTrimmerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport?: (payload: VideoTrimExportPayload) => Promise<void> | void;
  recordData: {
    cameraName: string;
    date: string;
    time: string;
    playbackUrl: string | null;
    duration: number;
    startTime: string;
  };
  eventTime: string; // ISO timestamp or HH:MM[:SS]
  timelineMarkerLabel?: string;
  liveContext?: boolean;
  canExport?: boolean;
  reviewActions?: React.ReactNode;
}

type TrimHandle = "start" | "end" | "scrubber";

interface DragState {
  handle: TrimHandle;
  pointerId: number;
  resumeAfterDrag: boolean;
}

export function VideoTrimmerModal({
  isOpen,
  onClose,
  onExport,
  recordData,
  eventTime,
  timelineMarkerLabel = "Trigger AI",
  liveContext = false,
  canExport = true,
  reviewActions,
}: VideoTrimmerModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const initialSession = getInitialTrimSession(recordData, eventTime);
  const [eventTimeLabel, setEventTimeLabel] = useState(
    formatEventTimeLabel(eventTime),
  );
  const [totalDuration, setTotalDuration] = useState(initialSession.duration);
  const [eventOffset, setEventOffset] = useState(initialSession.eventOffset);
  const [trimStart, setTrimStart] = useState(initialSession.trimStart);
  const [trimEnd, setTrimEnd] = useState(initialSession.trimEnd);
  const [currentTime, setCurrentTime] = useState(initialSession.trimStart);
  const currentTimeRef = useRef(initialSession.trimStart);

  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");

  const trackRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [activeHandle, setActiveHandle] = useState<TrimHandle | null>(null);
  const sourceKey = `${recordData.startTime}|${recordData.playbackUrl ?? ""}`;
  const sessionInputRef = useRef({ recordData, eventTime });
  const minimumClipDuration = Math.min(5, totalDuration);

  const getAbsoluteTimeStr = useCallback((relativeSecs: number) => {
    const value = new Date(recordData.startTime);
    value.setSeconds(value.getSeconds() + Math.max(0, relativeSecs));
    return `${value.getHours().toString().padStart(2, "0")}:${value
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${value.getSeconds().toString().padStart(2, "0")}`;
  }, [recordData.startTime]);

  function parseAbsoluteToRelative(input: string): number | null {
    const parts = input.split(":").map(Number);
    if (parts.some(Number.isNaN)) return null;

    let totalSecs = 0;
    if (parts.length === 3) {
      totalSecs = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      totalSecs = parts[0] * 3600 + parts[1] * 60;
    } else {
      return null;
    }

    const startDate = new Date(recordData.startTime);
    const startSeconds = startDate.getHours() * 3600 + startDate.getMinutes() * 60 + startDate.getSeconds();
    let relative = totalSecs - startSeconds;
    if (relative < 0) relative += 86400;
    if (relative < 0 || relative > totalDuration) return null;
    return relative;
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setStartInput(getAbsoluteTimeStr(trimStart));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [getAbsoluteTimeStr, trimStart]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setEndInput(getAbsoluteTimeStr(trimEnd));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [getAbsoluteTimeStr, trimEnd]);

  useEffect(() => {
    sessionInputRef.current = { recordData, eventTime };
  }, [eventTime, recordData]);

  useEffect(() => {
    if (!isOpen) return;

    const sessionInput = sessionInputRef.current;
    const session = getInitialTrimSession(
      sessionInput.recordData,
      sessionInput.eventTime,
    );
    currentTimeRef.current = session.trimStart;
    dragStateRef.current = null;
    document.body.style.overflow = "hidden";

    const video = previewVideoRef.current;
    video?.pause();
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekVideo(video, session.trimStart);
    }

    const timeout = window.setTimeout(() => {
      setTotalDuration(session.duration);
      setEventOffset(session.eventOffset);
      setEventTimeLabel(formatEventTimeLabel(sessionInput.eventTime));
      setTrimStart(session.trimStart);
      setTrimEnd(session.trimEnd);
      setCurrentTime(session.trimStart);
      setActiveHandle(null);
      setIsPlaying(false);
      setIsExporting(false);
      setExportError("");
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      video?.pause();
      dragStateRef.current = null;
      document.body.style.overflow = "";
    };
  }, [isOpen, sourceKey]);

  const setPreviewTime = useCallback((value: number) => {
    const bounded = Math.max(0, Math.min(value, totalDuration));
    currentTimeRef.current = bounded;
    setCurrentTime(bounded);
    if (previewVideoRef.current) seekVideo(previewVideoRef.current, bounded);
  }, [totalDuration]);

  const updateHandleValue = useCallback((handle: TrimHandle, value: number) => {
    const roundedValue = Math.round(value * 10) / 10;

    if (handle === "start") {
      const nextValue = Math.max(
        0,
        Math.min(roundedValue, trimEnd - minimumClipDuration),
      );
      setTrimStart(nextValue);
      if (currentTimeRef.current < nextValue) setPreviewTime(nextValue);
      return;
    }

    if (handle === "end") {
      const nextValue = Math.min(
        totalDuration,
        Math.max(roundedValue, trimStart + minimumClipDuration),
      );
      setTrimEnd(nextValue);
      if (currentTimeRef.current > nextValue) setPreviewTime(nextValue);
      return;
    }

    setPreviewTime(Math.max(trimStart, Math.min(roundedValue, trimEnd)));
  }, [minimumClipDuration, setPreviewTime, totalDuration, trimEnd, trimStart]);

  const updateHandleFromClientX = useCallback((
    handle: TrimHandle,
    clientX: number,
  ) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    updateHandleValue(handle, (x / rect.width) * totalDuration);
  }, [totalDuration, updateHandleValue]);

  const beginPointerInteraction = useCallback((
    handle: TrimHandle,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const video = previewVideoRef.current;
    const resumeAfterDrag = handle === "scrubber" && Boolean(video && !video.paused);
    video?.pause();
    setIsPlaying(false);

    dragStateRef.current = {
      handle,
      pointerId: event.pointerId,
      resumeAfterDrag,
    };
    setActiveHandle(handle);
    trackRef.current?.setPointerCapture(event.pointerId);
    updateHandleFromClientX(handle, event.clientX);
  }, [updateHandleFromClientX]);

  const handlePointerMove = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateHandleFromClientX(dragState.handle, event.clientX);
  }, [updateHandleFromClientX]);

  const finishPointerInteraction = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (trackRef.current?.hasPointerCapture(event.pointerId)) {
      trackRef.current.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setActiveHandle(null);

    if (
      dragState.resumeAfterDrag
      && currentTimeRef.current < trimEnd - 0.05
      && previewVideoRef.current
    ) {
      void previewVideoRef.current.play().catch(() => setIsPlaying(false));
    }
  }, [trimEnd]);

  const handlePlaybackToggle = useCallback(async () => {
    const video = previewVideoRef.current;
    if (!video || !recordData.playbackUrl) return;

    if (!video.paused) {
      video.pause();
      return;
    }

    if (
      currentTimeRef.current < trimStart
      || currentTimeRef.current >= trimEnd - 0.05
    ) {
      setPreviewTime(trimStart);
    }

    try {
      await video.play();
    } catch {
      setIsPlaying(false);
    }
  }, [recordData.playbackUrl, setPreviewTime, trimEnd, trimStart]);

  const handleSliderKeyDown = useCallback((
    handle: TrimHandle,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown"
      ? -1
      : event.key === "ArrowRight" || event.key === "ArrowUp"
        ? 1
        : 0;

    if (direction !== 0) {
      event.preventDefault();
      const current = handle === "start"
        ? trimStart
        : handle === "end"
          ? trimEnd
          : currentTimeRef.current;
      updateHandleValue(handle, current + direction);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const value = event.key === "Home"
        ? handle === "start"
          ? 0
          : handle === "end"
            ? trimStart + minimumClipDuration
            : trimStart
        : handle === "start"
          ? trimEnd - minimumClipDuration
          : handle === "end"
            ? totalDuration
            : trimEnd;
      updateHandleValue(handle, value);
    }
  }, [minimumClipDuration, totalDuration, trimEnd, trimStart, updateHandleValue]);

  const handleStartInputCommit = () => {
    const relative = parseAbsoluteToRelative(startInput);
    if (relative !== null && relative <= trimEnd - minimumClipDuration) {
      setTrimStart(relative);
      if (currentTimeRef.current < relative) setPreviewTime(relative);
    } else {
      setStartInput(getAbsoluteTimeStr(trimStart));
    }
  };

  const handleEndInputCommit = () => {
    const relative = parseAbsoluteToRelative(endInput);
    if (relative !== null && relative >= trimStart + minimumClipDuration) {
      setTrimEnd(relative);
      if (currentTimeRef.current > relative) setPreviewTime(relative);
    } else {
      setEndInput(getAbsoluteTimeStr(trimEnd));
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setExportError("");

    try {
      await onExport?.({
        trimStart,
        trimEnd,
        duration: trimEnd - trimStart,
        startLabel: getAbsoluteTimeStr(trimStart),
        endLabel: getAbsoluteTimeStr(trimEnd),
      });
      onClose();
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Klip gagal disimpan. Coba lagi."
      );
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  const clipDuration = Math.max(0, trimEnd - trimStart);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => !isExporting && onClose()}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-trimmer-title"
        className="relative z-10 flex flex-col w-full h-full max-w-5xl mx-auto"
      >
        <div className="flex-shrink-0 px-4 py-3 sm:px-8 sm:py-4 flex items-center justify-between border-b border-slate-800/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-500/15 rounded-xl flex-shrink-0">
              <Scissors className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 id="video-trimmer-title" className="text-base sm:text-xl font-bold text-white truncate">
                Video Trimmer
              </h2>
              <p className="text-slate-400 text-xs sm:text-sm truncate">
                {recordData.cameraName} / {recordData.date}
              </p>
            </div>
            {liveContext && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live tetap berjalan
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => !isExporting && onClose()}
            aria-label="Tutup video trimmer"
            title="Tutup"
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col overflow-y-auto px-3 py-3 sm:px-6 sm:py-5 gap-4">
          <div className="flex flex-none items-center justify-center sm:min-h-0 sm:flex-1">
            <div className="relative w-full max-h-full aspect-video bg-black rounded-xl sm:rounded-2xl overflow-hidden border border-slate-800/40 shadow-2xl max-w-4xl mx-auto">
              {recordData.playbackUrl ? (
                <video
                  ref={previewVideoRef}
                  src={recordData.playbackUrl}
                  aria-label={`Rekaman ${recordData.cameraName}`}
                  className={cn(
                    "w-full h-full object-cover transition-opacity duration-300",
                    isPlaying ? "opacity-100" : "opacity-70"
                  )}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(event) => {
                    seekVideo(event.currentTarget, currentTimeRef.current);
                  }}
                  onTimeUpdate={(event) => {
                    if (dragStateRef.current) return;

                    const video = event.currentTarget;
                    const nextTime = Math.max(
                      trimStart,
                      Math.min(totalDuration, video.currentTime),
                    );
                    currentTimeRef.current = nextTime;
                    setCurrentTime(nextTime);
                    if (!video.paused && nextTime >= trimEnd - 0.05) {
                      video.pause();
                      setPreviewTime(trimEnd);
                    }
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={(event) => {
                    setIsPlaying(false);
                    const boundedEnd = Math.min(trimEnd, event.currentTarget.duration);
                    currentTimeRef.current = boundedEnd;
                    setCurrentTime(boundedEnd);
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-900 text-sm font-semibold text-slate-400">
                  Video rekaman tidak tersedia
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20 pointer-events-none" />

              {!isPlaying && recordData.playbackUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => void handlePlaybackToggle()}
                    aria-label="Putar pratinjau klip"
                    title="Putar"
                    className="w-16 h-16 sm:w-20 sm:h-20 bg-white/15 hover:bg-white/25 backdrop-blur-md rounded-full flex items-center justify-center transition-all hover:scale-110 border border-white/20"
                  >
                    <Play className="w-6 h-6 sm:w-8 sm:h-8 text-white fill-white ml-1 sm:ml-1.5" />
                  </button>
                </div>
              )}

              <div className="absolute top-3 right-3 sm:top-4 sm:right-4 font-mono text-xs sm:text-base bg-black/70 px-2.5 py-1 sm:px-4 sm:py-2 rounded-lg border border-white/10 font-bold tracking-wider text-white backdrop-blur-md">
                {getAbsoluteTimeStr(currentTime)}
              </div>
              <div className="absolute top-3 left-3 sm:top-4 sm:left-4 bg-red-500 text-white px-2 py-0.5 sm:px-2.5 sm:py-1 rounded text-[9px] sm:text-xs font-bold tracking-widest flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse" />
                REC
              </div>

              {isPlaying && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                  <button
                    type="button"
                    onClick={() => void handlePlaybackToggle()}
                    aria-label="Jeda pratinjau klip"
                    className="px-4 py-2 bg-black/60 backdrop-blur-md rounded-full flex items-center gap-2 text-white text-xs font-medium border border-white/10 hover:bg-black/80 transition-colors"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 flex flex-col gap-3">
            <div className="flex items-center justify-between text-[10px] sm:text-xs font-medium text-slate-500 px-1">
              <span className="font-mono">{getAbsoluteTimeStr(0)}</span>
              <span className="flex items-center gap-1.5 bg-red-500/10 text-red-400 px-2.5 py-1 rounded-full border border-red-500/20 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {timelineMarkerLabel} ({eventTimeLabel})
              </span>
              <span className="font-mono">{getAbsoluteTimeStr(totalDuration)}</span>
            </div>

            <div
              className="relative h-12 sm:h-14 touch-none bg-slate-900 border border-slate-800 rounded-xl overflow-visible select-none"
              ref={trackRef}
              data-testid="video-trimmer-track"
              onPointerDown={(event) => beginPointerInteraction("scrubber", event)}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointerInteraction}
              onPointerCancel={finishPointerInteraction}
            >
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/50 rounded-l-xl"
                style={{ width: `${(trimStart / totalDuration) * 100}%` }}
              />
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/50 rounded-r-xl"
                style={{
                  width: `${((totalDuration - trimEnd) / totalDuration) * 100}%`,
                }}
              />
              <div
                className="absolute top-0 bottom-0 bg-blue-500/10 border-y border-blue-400/30"
                style={{
                  left: `${(trimStart / totalDuration) * 100}%`,
                  width: `${((trimEnd - trimStart) / totalDuration) * 100}%`,
                }}
              />
              <div
                className="absolute top-0 bottom-0 -translate-x-1/2 pointer-events-none z-[1]"
                style={{ left: `${(eventOffset / totalDuration) * 100}%` }}
              >
                <div className="w-px h-full bg-red-500/40" />
              </div>

              <div
                role="slider"
                tabIndex={0}
                aria-label="Posisi putar"
                aria-valuemin={trimStart}
                aria-valuemax={trimEnd}
                aria-valuenow={Math.round(currentTime * 10) / 10}
                className={cn(
                  "absolute top-0 bottom-0 z-20 cursor-ew-resize outline-none",
                  activeHandle === "scrubber" && "drop-shadow-[0_0_6px_rgba(255,255,255,0.75)]",
                )}
                style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                onPointerDown={(event) => beginPointerInteraction("scrubber", event)}
                onKeyDown={(event) => handleSliderKeyDown("scrubber", event)}
              >
                <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 bg-white" />
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[7px] border-t-white" />
              </div>

              <div
                role="slider"
                tabIndex={0}
                aria-label="Awal klip"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, trimEnd - minimumClipDuration)}
                aria-valuenow={Math.round(trimStart * 10) / 10}
                className="absolute top-0 bottom-0 z-10 cursor-ew-resize -translate-x-full outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                style={{ left: `${(trimStart / totalDuration) * 100}%` }}
                onPointerDown={(event) => beginPointerInteraction("start", event)}
                onKeyDown={(event) => handleSliderKeyDown("start", event)}
              >
                <div className="w-4 sm:w-5 h-full bg-amber-500 rounded-l-lg flex items-center justify-center hover:bg-amber-400 transition-colors">
                  <div className="w-0.5 h-5 bg-amber-800/30 rounded-full" />
                </div>
              </div>

              <div
                role="slider"
                tabIndex={0}
                aria-label="Akhir klip"
                aria-valuemin={Math.min(totalDuration, trimStart + minimumClipDuration)}
                aria-valuemax={totalDuration}
                aria-valuenow={Math.round(trimEnd * 10) / 10}
                className="absolute top-0 bottom-0 z-10 cursor-ew-resize outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                style={{ left: `${(trimEnd / totalDuration) * 100}%` }}
                onPointerDown={(event) => beginPointerInteraction("end", event)}
                onKeyDown={(event) => handleSliderKeyDown("end", event)}
              >
                <div className="w-4 sm:w-5 h-full bg-amber-500 rounded-r-lg flex items-center justify-center hover:bg-amber-400 transition-colors">
                  <div className="w-0.5 h-5 bg-amber-800/30 rounded-full" />
                </div>
              </div>
            </div>

            <div className="flex flex-shrink-0 flex-col items-stretch justify-between gap-3 rounded-xl border border-slate-800/50 bg-slate-900/60 p-3 sm:flex-row sm:items-center">
              <div className="grid w-full grid-cols-2 gap-2.5 sm:flex sm:w-auto sm:items-center sm:gap-3">
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Mulai
                  </span>
                  <input
                    type="text"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    onBlur={handleStartInputCommit}
                    onKeyDown={(e) => e.key === "Enter" && handleStartInputCommit()}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-center font-mono text-xs font-bold text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 sm:w-[100px] sm:py-1.5 sm:text-sm"
                  />
                </div>
                <div className="hidden text-slate-600 sm:block">-</div>
                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Selesai
                  </span>
                  <input
                    type="text"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    onBlur={handleEndInputCommit}
                    onKeyDown={(e) => e.key === "Enter" && handleEndInputCommit()}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-center font-mono text-xs font-bold text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 sm:w-[100px] sm:py-1.5 sm:text-sm"
                  />
                </div>
              </div>

              <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                <div className="whitespace-nowrap rounded-full border border-blue-500/20 bg-blue-500/15 px-2.5 py-1 text-[11px] font-bold text-blue-400 sm:text-sm">
                  {formatClipDuration(clipDuration)}
                </div>

                {canExport && (
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-500 disabled:opacity-70 sm:flex-none sm:py-2 sm:text-sm"
                  >
                    {isExporting ? (
                      "Mengekspor..."
                    ) : (
                      <>
                        <Download className="w-4 h-4" /> Ekspor & Simpan
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {reviewActions}

            {exportError && (
              <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                {exportError}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getInitialTrimSession(
  recordData: VideoTrimmerModalProps["recordData"],
  eventTime: string,
) {
  const duration = Math.max(
    1,
    Math.round(Number.isFinite(recordData.duration) ? recordData.duration : 1),
  );
  const eventOffset = getEventOffset(recordData.startTime, eventTime, duration);
  return {
    duration,
    eventOffset,
    trimStart: Math.max(0, eventOffset - 30),
    trimEnd: Math.min(duration, eventOffset + 30),
  };
}

function seekVideo(video: HTMLVideoElement, seconds: number) {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
  const mediaDuration = Number.isFinite(video.duration)
    ? Math.max(0, video.duration)
    : Math.max(0, seconds);
  const bounded = Math.max(0, Math.min(seconds, mediaDuration));
  if (Math.abs(video.currentTime - bounded) > 0.02) {
    video.currentTime = bounded;
  }
}

function formatClipDuration(seconds: number) {
  const rounded = Math.round(seconds * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`;
}

function getEventOffset(startTime: string, eventTime: string, duration: number) {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return Math.floor(duration / 2);
  }

  const absoluteEvent = new Date(eventTime);
  if (!Number.isNaN(absoluteEvent.getTime())) {
    const offset = Math.round((absoluteEvent.getTime() - start.getTime()) / 1000);
    return Math.max(0, Math.min(duration, offset));
  }

  const [hours, minutes, seconds = 0] = eventTime.split(":").map(Number);
  if (
    !Number.isFinite(hours)
    || !Number.isFinite(minutes)
    || !Number.isFinite(seconds)
  ) {
    return Math.floor(duration / 2);
  }

  const event = new Date(start);
  event.setHours(hours, minutes, seconds, 0);
  let offset = Math.round((event.getTime() - start.getTime()) / 1000);
  if (offset < 0) offset += 86400;
  return Math.max(0, Math.min(duration, offset));
}

function formatEventTimeLabel(value: string) {
  const absolute = new Date(value);
  if (!Number.isNaN(absolute.getTime())) {
    return new Intl.DateTimeFormat("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Jakarta",
    }).format(absolute);
  }

  return value;
}
