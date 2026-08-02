"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraOff, Radio, Video } from "lucide-react";
import { MediaMtxWebRtcReader } from "@/components/camera/mediamtx-webrtc-reader";
import { buildGatewayWebRtcReaderUrl, getDevicePublisherMediaPath } from "@/lib/media-gateway";
import type { MediaMtxWebRtcReaderStatus } from "@/lib/mediamtx-webrtc";
import type { Camera } from "@/lib/types";

export type LocalVideoDevice = {
  deviceId: string;
  label: string;
};

export type LiveCameraPlayerStatusState =
  | "idle"
  | "starting"
  | "active"
  | "permission-denied"
  | "busy"
  | "missing"
  | "unsupported"
  | "offline"
  | "preview"
  | "error"
  | "stopped";

export type LiveCameraPlayerStatus = {
  state: LiveCameraPlayerStatusState;
  message: string;
  deviceLabel?: string;
};

export type LiveBufferState = {
  available: boolean;
  start: number;
  end: number;
  current: number;
  duration: number;
  behindLive: number;
  /** Approximate wall-clock time represented by the seekable live edge. */
  liveEdgeAt: number;
};

export const EMPTY_LIVE_BUFFER: LiveBufferState = {
  available: false,
  start: 0,
  end: 0,
  current: 0,
  duration: 0,
  behindLive: 0,
  liveEdgeAt: 0,
};

type LiveCameraPlayerProps = {
  camera: Camera | undefined;
  fallbackImage: string;
  isOnline: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  useLocalWebcam: boolean;
  timeshiftBehindSeconds?: number | null;
  localDeviceId?: string;
  onLocalDevicesChange?: (devices: LocalVideoDevice[]) => void;
  onLocalStatusChange?: (status: LiveCameraPlayerStatus) => void;
  onLiveBufferChange?: (buffer: LiveBufferState) => void;
};

type PlaybackMode = "mock" | "local" | "video" | "image" | "unsupported" | "offline";

export function LiveCameraPlayer({
  camera,
  isOnline,
  isPlaying,
  isMuted,
  useLocalWebcam,
  timeshiftBehindSeconds = null,
  localDeviceId,
  onLocalDevicesChange,
  onLocalStatusChange,
  onLiveBufferChange,
}: LiveCameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const baseIsMutedRef = useRef(isMuted);
  const webRtcActiveRef = useRef(false);
  const [pausedFrameUrl, setPausedFrameUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveCameraPlayerStatus>({ state: "idle", message: "" });
  const statusRef = useRef<LiveCameraPlayerStatus>({ state: "idle", message: "" });
  const [isWebRtcActive, setIsWebRtcActive] = useState(false);
  const streamUrl = camera?.streamUrl?.trim() ?? "";
  const sourceType = camera?.sourceType ?? "mock";
  const mode = getPlaybackMode({ sourceType, streamUrl, isOnline, useLocalWebcam });
  const webRtcReaderUrl = camera && sourceType === "hls" && camera.mediaPath
    ? buildGatewayWebRtcReaderUrl(getDevicePublisherMediaPath(camera))
    : "";
  const isTimeshifted = timeshiftBehindSeconds !== null;
  const hlsRunsInBackground = Boolean(webRtcReaderUrl) && !isTimeshifted;
  const baseIsPlaying = hlsRunsInBackground ? true : isPlaying;
  const baseIsMuted = mode === "local" ? true : hlsRunsInBackground ? true : isMuted;
  const webRtcIsPlaying = isTimeshifted ? true : isPlaying;
  const webRtcIsMuted = isTimeshifted ? true : isMuted;
  const isTimeshiftedRef = useRef(isTimeshifted);

  useEffect(() => {
    isTimeshiftedRef.current = isTimeshifted;
  }, [isTimeshifted]);

  const handleWebRtcStatusChange = useCallback(
    (nextStatus: MediaMtxWebRtcReaderStatus) => {
      const active = nextStatus.state === "active";
      webRtcActiveRef.current = active;
      setIsWebRtcActive(active);

      if (active) {
        onLocalStatusChange?.({
          state: "active",
          message: nextStatus.message,
        });
        return;
      }

      if (!isTimeshiftedRef.current) {
        const fallbackStatus = statusRef.current;
        onLocalStatusChange?.(
          fallbackStatus.state === "idle"
            ? { state: "starting", message: "Menghubungkan kamera..." }
            : fallbackStatus,
        );
      }
    },
    [onLocalStatusChange],
  );

  useEffect(() => {
    baseIsMutedRef.current = baseIsMuted;
    const video = videoRef.current;
    if (!video) return;
    video.muted = baseIsMuted;
  }, [baseIsMuted]);

  useEffect(() => {
    isPlayingRef.current = baseIsPlaying;
    const video = videoRef.current;
    if (!video) return;

    const timeout = window.setTimeout(() => {
      if (baseIsPlaying) {
        setPausedFrameUrl(null);
        void video.play().catch(() => undefined);
        return;
      }

      const frameUrl = captureVideoFrame(video);
      if (frameUrl) setPausedFrameUrl(frameUrl);
      video.pause();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [baseIsPlaying, mode]);

  useEffect(() => {
    let cancelled = false;
    let hlsInstance: { destroy: () => void } | null = null;
    const statusTimeouts: number[] = [];
    const queueStatus = (nextStatus: LiveCameraPlayerStatus) => {
      const timeout = window.setTimeout(() => {
        if (cancelled) return;
        statusRef.current = nextStatus;
        setStatus(nextStatus);
        if (!webRtcActiveRef.current || isTimeshiftedRef.current) {
          onLocalStatusChange?.(nextStatus);
        }
      }, 0);
      statusTimeouts.push(timeout);
    };
    const video = videoRef.current;

    queueStatus({ state: "idle", message: "" });
    stopLocalStream(localStreamRef.current);
    localStreamRef.current = null;

    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.srcObject = null;
      video.load();
    }

    async function publishLocalDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices
          .filter((device) => device.kind === "videoinput")
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Kamera ${index + 1}`,
          }));
        if (!cancelled) onLocalDevicesChange?.(videoDevices);
      } catch {
        // Device enumeration is best-effort; playback can still work with browser default camera.
      }
    }

    async function startLocalWebcam() {
      if (!video) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        queueStatus({ state: "unsupported", message: "Browser belum mendukung akses webcam lokal." });
        return;
      }

      queueStatus({ state: "starting", message: "Meminta izin kamera lokal..." });

      try {
        const constraints: MediaStreamConstraints = {
          video: localDeviceId
            ? { deviceId: { exact: localDeviceId } }
            : { facingMode: { ideal: "environment" } },
          audio: false,
        };
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
          if (!localDeviceId || isHardWebcamFailure(error)) {
            throw error;
          }

          queueStatus({ state: "starting", message: "Kamera pilihan tidak tersedia, memakai kamera default..." });
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        if (cancelled) {
          stopLocalStream(stream);
          return;
        }

        localStreamRef.current = stream;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;

        if (isPlayingRef.current) {
          await video.play().catch(() => undefined);
        } else {
          video.pause();
        }

        await publishLocalDevices();
        const activeTrack = stream.getVideoTracks()[0];
        const activeLabel = activeTrack?.label;
        activeTrack?.addEventListener("ended", () => {
          queueStatus({ state: "stopped", message: "Webcam berhenti. Kamera mungkin dicabut atau dipakai aplikasi lain." });
        });
        queueStatus({
          state: "active",
          message: activeLabel ? `Webcam aktif: ${activeLabel}` : "Webcam aktif",
          deviceLabel: activeLabel,
        });
      } catch (error) {
        queueStatus(getFriendlyWebcamStatus(error));
      }
    }

    async function startVideoStream() {
      if (!video || !streamUrl) return;

      if (isHlsStream(streamUrl, sourceType)) {
        queueStatus({ state: "starting", message: "Menghubungkan kamera..." });

        const Hls = (await import("hls.js")).default;
        if (!Hls.isSupported() && video.canPlayType("application/vnd.apple.mpegurl")) {
          let nativeRetryCount = 0;
          let nativeRetryTimeout: number | null = null;
          const resetNativeRetry = () => {
            nativeRetryCount = 0;
            if (nativeRetryTimeout !== null) {
              window.clearTimeout(nativeRetryTimeout);
              nativeRetryTimeout = null;
            }
          };
          const loadNativeHls = async () => {
            video.src = streamUrl;
            video.playsInline = true;
            video.muted = baseIsMutedRef.current;
            video.load();
            if (isPlayingRef.current) await video.play().catch(() => undefined);
          };
          const retryNativeHls = () => {
            if (cancelled || nativeRetryTimeout !== null) return;
            nativeRetryCount += 1;
            const retryDelay = Math.min(5000, 1000 + nativeRetryCount * 500);
            queueStatus({ state: "offline", message: "Kamera belum mengirim tayangan. Mencoba kembali..." });
            const retryTimeout = window.setTimeout(() => {
              nativeRetryTimeout = null;
              if (!cancelled) void loadNativeHls();
            }, retryDelay);
            nativeRetryTimeout = retryTimeout;
            statusTimeouts.push(retryTimeout);
          };

          video.onloadedmetadata = () => {
            resetNativeRetry();
            queueStatus({ state: "active", message: "Tayangan kamera aktif." });
          };
          video.oncanplay = () => {
            resetNativeRetry();
            queueStatus({ state: "active", message: "Tayangan kamera aktif." });
          };
          video.onerror = () => retryNativeHls();
          await loadNativeHls();
          return;
        }

        if (!Hls.isSupported()) {
          queueStatus({ state: "unsupported", message: "Tayangan kamera belum didukung pada perangkat ini." });
          return;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 600,
          maxBufferLength: 60,
          maxMaxBufferLength: 600,
          liveSyncDurationCount: 2,
        });
        let hlsRetryCount = 0;
        let hlsRetryTimeout: number | null = null;
        let hlsActiveAnnounced = false;
        const resetHlsRetry = () => {
          hlsRetryCount = 0;
          if (hlsRetryTimeout !== null) {
            window.clearTimeout(hlsRetryTimeout);
            hlsRetryTimeout = null;
          }
        };
        const announceHlsActive = () => {
          resetHlsRetry();
          if (hlsActiveAnnounced) return;
          hlsActiveAnnounced = true;
          queueStatus({ state: "active", message: "Tayangan kamera aktif." });
        };
        const retryHlsStream = () => {
          if (cancelled || hlsRetryTimeout !== null) return;

          hlsActiveAnnounced = false;
          hlsRetryCount += 1;
          const retryDelay = Math.min(5000, 1000 + hlsRetryCount * 500);
          queueStatus({ state: "offline", message: "Kamera belum mengirim tayangan. Mencoba kembali..." });
          const retryTimeout = window.setTimeout(() => {
            hlsRetryTimeout = null;
            if (cancelled) return;
            hls.startLoad();
          }, retryDelay);
          hlsRetryTimeout = retryTimeout;
          statusTimeouts.push(retryTimeout);
        };

        hlsInstance = hls;
        hls.attachMedia(video);
        hls.loadSource(streamUrl);
        hls.on(Hls.Events.MANIFEST_PARSED, async () => {
          announceHlsActive();
          if (isPlayingRef.current) await video.play().catch(() => undefined);
        });
        hls.on(Hls.Events.LEVEL_LOADED, () => {
          announceHlsActive();
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          retryHlsStream();
        });
        return;
      }
      video.src = streamUrl;
      video.playsInline = true;
      video.muted = baseIsMutedRef.current;
      if (isPlayingRef.current) await video.play().catch(() => undefined);
      queueStatus({ state: "active", message: "Stream video aktif" });
    }

    if (mode === "local") {
      void startLocalWebcam();
    } else if (mode === "video") {
      void startVideoStream();
    } else if (mode === "unsupported") {
      queueStatus({ state: "unsupported", message: getUnsupportedMessage(sourceType) });
    } else if (mode === "mock") {
      queueStatus({ state: "preview", message: "Preview kamera" });
    } else if (mode === "offline") {
      queueStatus({ state: "offline", message: "Kamera belum terhubung." });
    }

    return () => {
      cancelled = true;
      statusTimeouts.forEach((timeout) => window.clearTimeout(timeout));
      hlsInstance?.destroy();
      stopLocalStream(localStreamRef.current);
      localStreamRef.current = null;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.srcObject = null;
      }
    };
  }, [localDeviceId, mode, onLocalDevicesChange, onLocalStatusChange, sourceType, streamUrl]);

  const reportLiveBuffer = useCallback(() => {
    if (!onLiveBufferChange || !isHlsStream(streamUrl, sourceType)) return;

    const video = videoRef.current;
    if (!video || video.seekable.length === 0) {
      onLiveBufferChange(EMPTY_LIVE_BUFFER);
      return;
    }

    const start = video.seekable.start(0);
    const end = video.seekable.end(video.seekable.length - 1);
    const duration = Math.max(0, end - start);
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : end;
    const current = Math.min(Math.max(currentTime, start), end);

    onLiveBufferChange({
      available: duration >= 1,
      start,
      end,
      current,
      duration,
      behindLive: Math.max(0, end - current),
      liveEdgeAt: Date.now(),
    });
  }, [onLiveBufferChange, sourceType, streamUrl]);

  useEffect(() => {
    if (!onLiveBufferChange || !isHlsStream(streamUrl, sourceType)) return;

    let frameId = 0;
    let lastReportAt = 0;
    const reportAtAnimationFrame = (timestamp: number) => {
      if (timestamp - lastReportAt >= 80) {
        lastReportAt = timestamp;
        reportLiveBuffer();
      }
      frameId = window.requestAnimationFrame(reportAtAnimationFrame);
    };

    frameId = window.requestAnimationFrame(reportAtAnimationFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [onLiveBufferChange, reportLiveBuffer, sourceType, streamUrl]);

  useEffect(() => {
    onLiveBufferChange?.(EMPTY_LIVE_BUFFER);
  }, [camera?.id, onLiveBufferChange, streamUrl]);

  useEffect(() => {
    if (!isHlsStream(streamUrl, sourceType)) return;

    let retryTimeout: number | null = null;
    let attempts = 0;

    const applyTimeshift = () => {
      const video = videoRef.current;
      if (!video || video.seekable.length === 0) {
        attempts += 1;
        if (attempts <= 20) {
          retryTimeout = window.setTimeout(applyTimeshift, 250);
        }
        return;
      }

      const start = video.seekable.start(0);
      const end = video.seekable.end(video.seekable.length - 1);

      if (timeshiftBehindSeconds === null) {
        if (end - video.currentTime > 2) {
          video.currentTime = Math.max(start, end - 0.15);
        }
      } else {
        const target = Math.min(
          Math.max(end - timeshiftBehindSeconds, start + 0.05),
          end - 0.15,
        );
        if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.25) {
          video.currentTime = target;
        }
      }

      reportLiveBuffer();
    };

    const initialAttempt = window.setTimeout(applyTimeshift, 0);
    return () => {
      window.clearTimeout(initialAttempt);
      if (retryTimeout !== null) window.clearTimeout(retryTimeout);
    };
  }, [reportLiveBuffer, sourceType, streamUrl, timeshiftBehindSeconds]);

  const showVideo = mode === "local" || mode === "video";
  const showImageStream = mode === "image" && streamUrl;
  const showFallbackImage = !showVideo && !showImageStream;
  const showState =
    shouldShowStateOverlay(mode, status)
    && !(isWebRtcActive && !isTimeshifted);

  return (
    <div className="absolute inset-0 bg-[#1e293b]">
      {showFallbackImage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f172a] text-slate-500">
          <CameraOff className="mb-3 h-10 w-10 opacity-50" />
          <p className="text-[13px] font-medium">{isOnline ? "Tayangan belum tersedia" : "Kamera belum terhubung"}</p>
        </div>
      )}

      {showImageStream && (
        <img data-live-media="primary" src={streamUrl} className="w-full h-full object-cover" alt="Live Camera Stream" />
      )}

      {showVideo && (
        <video
          ref={videoRef}
          data-live-media={mode === "local" ? "primary" : "hls-fallback"}
          className="h-full w-full object-cover"
          autoPlay={baseIsPlaying}
          muted={baseIsMuted}
          playsInline
          preload="auto"
          onCanPlay={reportLiveBuffer}
          onDurationChange={reportLiveBuffer}
          onLoadedMetadata={reportLiveBuffer}
          onProgress={reportLiveBuffer}
          onSeeked={reportLiveBuffer}
          onTimeUpdate={reportLiveBuffer}
        />
      )}

      {webRtcReaderUrl && mode === "video" && (
        <MediaMtxWebRtcReader
          url={webRtcReaderUrl}
          isPlaying={webRtcIsPlaying}
          isMuted={webRtcIsMuted}
          isVisible={!isTimeshifted}
          onStatusChange={handleWebRtcStatusChange}
        />
      )}

      {pausedFrameUrl && !baseIsPlaying && showVideo && (
        <div className="pointer-events-none absolute inset-0 bg-black">
          <img src={pausedFrameUrl} className="h-full w-full object-cover" alt="Paused camera frame" />
          <div className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-[11px] font-bold tracking-wide text-white backdrop-blur-sm">
            PAUSED
          </div>
        </div>
      )}

      {showState && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/25 px-6 text-center">
          <div className="rounded-2xl border border-white/15 bg-black/55 px-4 py-3 text-white shadow-lg backdrop-blur-md max-w-[280px]">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
              {mode === "unsupported" || mode === "offline" ? <CameraOff className="h-5 w-5" /> : mode === "local" ? <Video className="h-5 w-5" /> : <Radio className="h-5 w-5" />}
            </div>
            <p className="text-[12px] pwa:text-[13px] font-bold leading-snug">{status.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function captureVideoFrame(video: HTMLVideoElement) {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return null;
  }
}
function getPlaybackMode({
  sourceType,
  streamUrl,
  isOnline,
  useLocalWebcam,
}: {
  sourceType: Camera["sourceType"];
  streamUrl: string;
  isOnline: boolean;
  useLocalWebcam: boolean;
}): PlaybackMode {
  if (useLocalWebcam) return "local";
  if (!isOnline) return "offline";
  if (sourceType === "mock" || !streamUrl) return "mock";
  if (sourceType === "rtsp" || sourceType === "nvr" || sourceType === "webrtc") return "unsupported";
  if (sourceType === "phone-webcam" && !isHlsStream(streamUrl, sourceType) && !isDirectVideo(streamUrl)) return "image";
  return "video";
}

function isHlsStream(streamUrl: string, sourceType: Camera["sourceType"]) {
  return sourceType === "hls" || streamUrl.toLowerCase().includes(".m3u8");
}

function isDirectVideo(streamUrl: string) {
  return /\.(mp4|webm|ogg)(\?|#|$)/i.test(streamUrl);
}

function getUnsupportedMessage(sourceType: Camera["sourceType"]) {
  if (sourceType === "rtsp" || sourceType === "nvr" || sourceType === "webrtc") {
    return "Kamera ini perlu dikonfigurasi ulang oleh pengawas.";
  }
  return "Tayangan kamera belum dapat diputar.";
}

function shouldShowStateOverlay(mode: PlaybackMode, status: LiveCameraPlayerStatus) {
  if (!status.message) return false;
  if (mode === "offline" || mode === "unsupported") return true;
  return ["starting", "permission-denied", "busy", "missing", "unsupported", "offline", "error", "stopped"].includes(status.state);
}

function getFriendlyWebcamStatus(error: unknown): LiveCameraPlayerStatus {
  if (!(error instanceof DOMException)) {
    return { state: "error", message: "Kamera lokal belum bisa diakses." };
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return { state: "permission-denied", message: "Izin kamera ditolak. Izinkan akses kamera di browser." };
  }

  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return { state: "busy", message: "Kamera sedang dipakai aplikasi lain atau belum siap." };
  }

  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return { state: "missing", message: "Tidak ada kamera lokal terdeteksi." };
  }

  if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
    return { state: "missing", message: "Kamera yang dipilih tidak tersedia. Refresh atau pilih kamera lain." };
  }

  if (error.name === "AbortError") {
    return { state: "error", message: "Kamera gagal mulai. Coba refresh kamera." };
  }

  return { state: "error", message: error.message || "Kamera lokal belum bisa diakses." };
}

function isHardWebcamFailure(error: unknown) {
  if (!(error instanceof DOMException)) return true;
  return ["NotAllowedError", "SecurityError", "NotReadableError", "TrackStartError"].includes(error.name);
}

function stopLocalStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
