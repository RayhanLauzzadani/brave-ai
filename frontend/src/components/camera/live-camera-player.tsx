"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Radio, Video } from "lucide-react";
import type { Camera } from "@/lib/types";
import { cn } from "@/lib/utils";

type LiveCameraPlayerProps = {
  camera: Camera | undefined;
  fallbackImage: string;
  isOnline: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  useLocalWebcam: boolean;
};

type PlaybackMode = "mock" | "local" | "video" | "image" | "unsupported" | "offline";

export function LiveCameraPlayer({
  camera,
  fallbackImage,
  isOnline,
  isPlaying,
  isMuted,
  useLocalWebcam,
}: LiveCameraPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [message, setMessage] = useState("");
  const streamUrl = camera?.streamUrl?.trim() ?? "";
  const sourceType = camera?.sourceType ?? "mock";
  const mode = getPlaybackMode({ sourceType, streamUrl, isOnline, useLocalWebcam });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [isPlaying, mode]);

  useEffect(() => {
    let cancelled = false;
    let hlsInstance: { destroy: () => void } | null = null;
    const messageTimeouts: number[] = [];
    const queueMessage = (value: string) => {
      const timeout = window.setTimeout(() => {
        if (!cancelled) setMessage(value);
      }, 0);
      messageTimeouts.push(timeout);
    };
    const video = videoRef.current;

    queueMessage("");
    stopLocalStream(localStreamRef.current);
    localStreamRef.current = null;

    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.srcObject = null;
      video.load();
    }

    async function startLocalWebcam() {
      if (!video) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        queueMessage("Browser belum mengizinkan akses kamera lokal.");
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
        } catch {
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
        await video.play().catch(() => undefined);
        queueMessage("Webcam lokal aktif");
      } catch (error) {
        queueMessage(error instanceof Error ? error.message : "Kamera lokal belum bisa diakses.");
      }
    }

    async function startVideoStream() {
      if (!video || !streamUrl) return;

      if (isHlsStream(streamUrl, sourceType)) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = streamUrl;
          await video.play().catch(() => undefined);
          queueMessage("HLS aktif");
          return;
        }

        const Hls = (await import("hls.js")).default;
        if (!Hls.isSupported()) {
          queueMessage("Browser belum mendukung HLS untuk stream ini.");
          return;
        }

        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsInstance = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) queueMessage("Stream HLS belum bisa diputar.");
        });
        queueMessage("HLS aktif");
        return;
      }

      video.src = streamUrl;
      video.playsInline = true;
      video.muted = isMuted;
      await video.play().catch(() => undefined);
      queueMessage("Stream video aktif");
    }

    if (mode === "local") {
      void startLocalWebcam();
    } else if (mode === "video") {
      void startVideoStream();
    } else if (mode === "unsupported") {
      queueMessage(getUnsupportedMessage(sourceType));
    } else if (mode === "mock") {
      queueMessage("Preview kamera");
    } else if (mode === "offline") {
      queueMessage("Kamera offline");
    }

    return () => {
      cancelled = true;
      messageTimeouts.forEach((timeout) => window.clearTimeout(timeout));
      hlsInstance?.destroy();
      stopLocalStream(localStreamRef.current);
      localStreamRef.current = null;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.srcObject = null;
      }
    };
  }, [isMuted, mode, sourceType, streamUrl]);

  const showVideo = mode === "local" || mode === "video";
  const showImageStream = mode === "image" && streamUrl;
  const showFallbackImage = !showVideo && !showImageStream;
  const showState = mode !== "image" && message;

  return (
    <div className="absolute inset-0 bg-[#1e293b]">
      {showFallbackImage && (
        <img
          src={fallbackImage}
          className={cn("w-full h-full object-cover", (!isOnline || mode !== "mock") && "grayscale opacity-70")}
          alt="Live Camera"
        />
      )}

      {showImageStream && (
        <img src={streamUrl} className="w-full h-full object-cover" alt="Live Camera Stream" />
      )}

      {showVideo && (
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          muted={isMuted || mode === "local"}
          playsInline
          preload="metadata"
        />
      )}

      {showState && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/25 px-6 text-center">
          <div className="rounded-2xl border border-white/15 bg-black/55 px-4 py-3 text-white shadow-lg backdrop-blur-md max-w-[280px]">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
              {mode === "unsupported" || mode === "offline" ? <CameraOff className="h-5 w-5" /> : mode === "local" ? <Video className="h-5 w-5" /> : <Radio className="h-5 w-5" />}
            </div>
            <p className="text-[12px] pwa:text-[13px] font-bold leading-snug">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
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

function stopLocalStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
