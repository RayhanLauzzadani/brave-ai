"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Radio, Video } from "lucide-react";
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

type LiveCameraPlayerProps = {
  camera: Camera | undefined;
  fallbackImage: string;
  isOnline: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  useLocalWebcam: boolean;
  localDeviceId?: string;
  onLocalDevicesChange?: (devices: LocalVideoDevice[]) => void;
  onLocalStatusChange?: (status: LiveCameraPlayerStatus) => void;
};

type PlaybackMode = "mock" | "local" | "video" | "image" | "unsupported" | "offline";

export function LiveCameraPlayer({
  camera,
  isOnline,
  isPlaying,
  isMuted,
  useLocalWebcam,
  localDeviceId,
  onLocalDevicesChange,
  onLocalStatusChange,
}: LiveCameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const [pausedFrameUrl, setPausedFrameUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveCameraPlayerStatus>({ state: "idle", message: "" });
  const streamUrl = camera?.streamUrl?.trim() ?? "";
  const sourceType = camera?.sourceType ?? "mock";
  const mode = getPlaybackMode({ sourceType, streamUrl, isOnline, useLocalWebcam });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = mode === "local" ? true : isMuted;
  }, [isMuted, mode]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    const video = videoRef.current;
    if (!video) return;

    const timeout = window.setTimeout(() => {
      if (isPlaying) {
        setPausedFrameUrl(null);
        void video.play().catch(() => undefined);
        return;
      }

      const frameUrl = captureVideoFrame(video);
      if (frameUrl) setPausedFrameUrl(frameUrl);
      video.pause();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [isPlaying, mode]);

  useEffect(() => {
    let cancelled = false;
    let hlsInstance: { destroy: () => void } | null = null;
    const statusTimeouts: number[] = [];
    const queueStatus = (nextStatus: LiveCameraPlayerStatus) => {
      const timeout = window.setTimeout(() => {
        if (cancelled) return;
        setStatus(nextStatus);
        onLocalStatusChange?.(nextStatus);
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
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = streamUrl;
          if (isPlayingRef.current) await video.play().catch(() => undefined);
          queueStatus({ state: "active", message: "HLS aktif" });
          return;
        }

        const Hls = (await import("hls.js")).default;
        if (!Hls.isSupported()) {
          queueStatus({ state: "unsupported", message: "Browser belum mendukung HLS untuk stream ini." });
          return;
        }

        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsInstance = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) queueStatus({ state: "error", message: "Stream HLS belum bisa diputar." });
        });
        queueStatus({ state: "active", message: "HLS aktif" });
        return;
      }

      video.src = streamUrl;
      video.playsInline = true;
      video.muted = isMuted;
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
      queueStatus({ state: "offline", message: "Kamera offline" });
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
  }, [isMuted, localDeviceId, mode, onLocalDevicesChange, onLocalStatusChange, sourceType, streamUrl]);

  const showVideo = mode === "local" || mode === "video";
  const showImageStream = mode === "image" && streamUrl;
  const showFallbackImage = !showVideo && !showImageStream;
  const showState = shouldShowStateOverlay(mode, status);

  return (
    <div className="absolute inset-0 bg-[#1e293b]">
      {showFallbackImage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f172a] text-slate-500">
          <CameraOff className="mb-3 h-10 w-10 opacity-50" />
          <p className="text-[13px] font-medium">{isOnline ? "Preview tidak tersedia" : "Kamera Offline"}</p>
        </div>
      )}

      {showImageStream && (
        <img data-live-media="primary" src={streamUrl} className="w-full h-full object-cover" alt="Live Camera Stream" />
      )}

      {showVideo && (
        <video
          ref={videoRef}
          data-live-media="primary"
          className="w-full h-full object-cover"
          autoPlay={isPlaying}
          muted={mode === "local" ? true : isMuted}
          playsInline
          preload="metadata"
        />
      )}

      {pausedFrameUrl && !isPlaying && showVideo && (
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
  if (sourceType === "rtsp") return "RTSP perlu media gateway ke HLS/WebRTC";
  if (sourceType === "nvr") return "NVR/DVR perlu gateway playback";
  if (sourceType === "webrtc") return "WebRTC perlu signaling server";
  return "Sumber belum bisa diputar langsung";
}

function shouldShowStateOverlay(mode: PlaybackMode, status: LiveCameraPlayerStatus) {
  if (!status.message) return false;
  if (mode === "offline" || mode === "unsupported") return true;
  return ["permission-denied", "busy", "missing", "unsupported", "error", "stopped"].includes(status.state);
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
