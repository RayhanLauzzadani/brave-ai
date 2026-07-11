"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
  eventTime: string; // HH:MM
}

export function VideoTrimmerModal({
  isOpen,
  onClose,
  onExport,
  recordData,
  eventTime,
}: VideoTrimmerModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const totalDuration = Math.max(1, Math.round(recordData.duration));
  const eventOffset = getEventOffset(recordData.startTime, eventTime, totalDuration);
  const initialTrimStart = Math.max(0, eventOffset - 30);
  const initialTrimEnd = Math.min(totalDuration, eventOffset + 30);

  const [trimStart, setTrimStart] = useState(initialTrimStart);
  const [trimEnd, setTrimEnd] = useState(initialTrimEnd);
  const [currentTime, setCurrentTime] = useState(initialTrimStart);

  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");

  const trackRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<
    "start" | "end" | "scrubber" | null
  >(null);

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
    if (relative < -43200) relative += 86400;
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
    let timeout: number | undefined;

    if (isOpen) {
      timeout = window.setTimeout(() => {
        setTrimStart(initialTrimStart);
        setTrimEnd(initialTrimEnd);
        setCurrentTime(initialTrimStart);
        setIsPlaying(false);
        setIsExporting(false);
        setExportError("");
      }, 0);
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (timeout) window.clearTimeout(timeout);
      document.body.style.overflow = "";
    };
  }, [initialTrimEnd, initialTrimStart, isOpen]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !recordData.playbackUrl) return;

    if (!isPlaying) {
      video.pause();
      return;
    }

    if (video.currentTime < trimStart || video.currentTime >= trimEnd) {
      video.currentTime = trimStart;
    }
    void video.play().catch(() => setIsPlaying(false));
  }, [isPlaying, recordData.playbackUrl, trimEnd, trimStart]);

  const setPreviewTime = useCallback((value: number) => {
    const bounded = Math.max(0, Math.min(value, totalDuration));
    setCurrentTime(bounded);
    if (previewVideoRef.current) previewVideoRef.current.currentTime = bounded;
  }, [totalDuration]);
  const handlePointerMove = useCallback((clientX: number) => {
    if (!trackRef.current || !activeHandle) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const value = Math.round(percent * totalDuration);

    if (activeHandle === "start") {
      const nextValue = Math.max(0, Math.min(value, trimEnd - 5));
      setTrimStart(nextValue);
      if (currentTime < nextValue) setPreviewTime(nextValue);
    } else if (activeHandle === "end") {
      const nextValue = Math.min(totalDuration, Math.max(value, trimStart + 5));
      setTrimEnd(nextValue);
      if (currentTime > nextValue) setPreviewTime(nextValue);
    } else if (activeHandle === "scrubber") {
      setPreviewTime(value);
    }
  }, [activeHandle, currentTime, setPreviewTime, totalDuration, trimEnd, trimStart]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (activeHandle) handlePointerMove(e.clientX);
    };
    const onMouseUp = () => setActiveHandle(null);

    if (activeHandle) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [activeHandle, handlePointerMove]);

  const handleStartInputCommit = () => {
    const relative = parseAbsoluteToRelative(startInput);
    if (relative !== null && relative < trimEnd - 5) {
      setTrimStart(relative);
      if (currentTime < relative) setPreviewTime(relative);
    } else {
      setStartInput(getAbsoluteTimeStr(trimStart));
    }
  };

  const handleEndInputCommit = () => {
    const relative = parseAbsoluteToRelative(endInput);
    if (relative !== null && relative > trimStart + 5) {
      setTrimEnd(relative);
      if (currentTime > relative) setPreviewTime(relative);
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

  const clipDuration = trimEnd - trimStart;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={() => !isExporting && onClose()}
      />

      <div className="relative z-10 flex flex-col w-full h-full">
        <div className="flex-shrink-0 px-4 py-3 sm:px-8 sm:py-4 flex items-center justify-between border-b border-slate-800/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-blue-500/15 rounded-xl flex-shrink-0">
              <Scissors className="w-5 h-5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-bold text-white truncate">
                Video Trimmer
              </h2>
              <p className="text-slate-400 text-xs sm:text-sm truncate">
                {recordData.cameraName} / {recordData.date}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isExporting && onClose()}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col overflow-y-auto px-4 py-4 sm:px-8 sm:py-6 gap-5">
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <div className="relative w-full max-h-full aspect-video bg-black rounded-xl sm:rounded-2xl overflow-hidden border border-slate-800/40 shadow-2xl">
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
                    event.currentTarget.currentTime = initialTrimStart;
                  }}
                  onTimeUpdate={(event) => {
                    const nextTime = Math.min(totalDuration, event.currentTarget.currentTime);
                    setCurrentTime(nextTime);
                    if (nextTime >= trimEnd) {
                      event.currentTarget.pause();
                      setIsPlaying(false);
                    }
                  }}
                  onEnded={() => setIsPlaying(false)}
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
                    onClick={() => setIsPlaying(true)}
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
                    onClick={() => setIsPlaying(false)}
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
                Trigger AI ({eventTime})
              </span>
              <span className="font-mono">{getAbsoluteTimeStr(totalDuration)}</span>
            </div>

            <div
              className="relative h-12 sm:h-14 bg-slate-900 border border-slate-800 rounded-xl overflow-visible select-none"
              ref={trackRef}
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
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 pointer-events-none z-[1]">
                <div className="w-px h-full bg-red-500/40" />
              </div>

              <div
                className="absolute top-0 bottom-0 z-20 cursor-ew-resize"
                style={{ left: `${(currentTime / totalDuration) * 100}%` }}
                onMouseDown={() => setActiveHandle("scrubber")}
              >
                <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-0.5 bg-white" />
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[7px] border-t-white" />
              </div>

              <div
                className="absolute top-0 bottom-0 z-10 cursor-ew-resize -translate-x-full"
                style={{ left: `${(trimStart / totalDuration) * 100}%` }}
                onMouseDown={() => setActiveHandle("start")}
              >
                <div className="w-4 sm:w-5 h-full bg-amber-500 rounded-l-lg flex items-center justify-center hover:bg-amber-400 transition-colors">
                  <div className="w-0.5 h-5 bg-amber-800/30 rounded-full" />
                </div>
              </div>

              <div
                className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
                style={{ left: `${(trimEnd / totalDuration) * 100}%` }}
                onMouseDown={() => setActiveHandle("end")}
              >
                <div className="w-4 sm:w-5 h-full bg-amber-500 rounded-r-lg flex items-center justify-center hover:bg-amber-400 transition-colors">
                  <div className="w-0.5 h-5 bg-amber-800/30 rounded-full" />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 rounded-xl p-3 sm:p-4 border border-slate-800/50">
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Mulai
                  </span>
                  <input
                    type="text"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    onBlur={handleStartInputCommit}
                    onKeyDown={(e) => e.key === "Enter" && handleStartInputCommit()}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-mono font-bold text-white w-[100px] sm:w-[110px] text-center focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>
                <div className="text-slate-600">-</div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Selesai
                  </span>
                  <input
                    type="text"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    onBlur={handleEndInputCommit}
                    onKeyDown={(e) => e.key === "Enter" && handleEndInputCommit()}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-sm font-mono font-bold text-white w-[100px] sm:w-[110px] text-center focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>
                <div className="bg-blue-500/15 text-blue-400 px-3 py-1.5 rounded-full font-bold text-xs sm:text-sm border border-blue-500/20 whitespace-nowrap">
                  {clipDuration}s
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsPlaying(!isPlaying)}
                  disabled={!recordData.playbackUrl}
                  className="w-10 h-10 flex items-center justify-center bg-slate-800 hover:bg-slate-700 rounded-full transition-colors text-white flex-shrink-0 border border-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4 ml-0.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => !isExporting && onClose()}
                  disabled={isExporting}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors border border-slate-700 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm px-5 py-2.5 transition-colors disabled:opacity-70 shadow-lg shadow-blue-600/20"
                >
                  {isExporting ? (
                    "Mengekspor..."
                  ) : (
                    <>
                      <Download className="w-4 h-4" /> Ekspor & Simpan
                    </>
                  )}
                </button>
              </div>
            </div>

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

function getEventOffset(startTime: string, eventTime: string, duration: number) {
  const start = new Date(startTime);
  const [hours, minutes] = eventTime.split(":").map(Number);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Math.floor(duration / 2);
  }

  const event = new Date(start);
  event.setHours(hours, minutes, 0, 0);
  let offset = Math.round((event.getTime() - start.getTime()) / 1000);
  if (offset < -43200) offset += 86400;
  return Math.max(0, Math.min(duration, offset));
}
