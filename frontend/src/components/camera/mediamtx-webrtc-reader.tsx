"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  loadMediaMtxWebRtcReader,
  type MediaMtxWebRtcReaderInstance,
  type MediaMtxWebRtcReaderStatus,
} from "@/lib/mediamtx-webrtc";

type MediaMtxWebRtcReaderProps = {
  url: string;
  isPlaying: boolean;
  isMuted: boolean;
  onStatusChange?: (status: MediaMtxWebRtcReaderStatus) => void;
};

export function MediaMtxWebRtcReader({
  url,
  isPlaying,
  isMuted,
  onStatusChange,
}: MediaMtxWebRtcReaderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<MediaMtxWebRtcReaderInstance | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isMutedRef = useRef(isMuted);
  const [isActive, setIsActive] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    isMutedRef.current = isMuted;
    const video = videoRef.current;
    if (!video) return;

    video.muted = isMuted;
    if (isPlaying) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [isMuted, isPlaying]);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: number | null = null;
    let receivedTrack = false;
    const video = videoRef.current;
    if (!video || !url) return;

    const scheduleRetry = () => {
      if (retryTimeout !== null || cancelled) return;
      retryTimeout = window.setTimeout(() => {
        retryTimeout = null;
        if (!cancelled) setRetryToken((current) => current + 1);
      }, 5000);
    };

    setIsActive(false);
    onStatusChange?.({ state: "starting", message: "Mencoba preview WebRTC latency rendah..." });

    void loadMediaMtxWebRtcReader()
      .then((Reader) => {
        if (cancelled) return;

        const reader = new Reader({
          url,
          onTrack: (event) => {
            const stream = event.streams[0];
            if (cancelled || !stream) return;

            receivedTrack = true;
            if (retryTimeout !== null) {
              window.clearTimeout(retryTimeout);
              retryTimeout = null;
            }
            video.srcObject = stream;
            video.muted = isMutedRef.current;
            setIsActive(true);
            onStatusChange?.({ state: "active", message: "WebRTC aktif: preview latency rendah." });
            if (isPlayingRef.current) {
              void video.play().catch(() => undefined);
            }
          },
          onError: (message) => {
            if (cancelled) return;

            setIsActive(false);
            onStatusChange?.({
              state: "starting",
              message: "Koneksi WebRTC belum stabil. HLS dipakai sebagai fallback.",
            });

            if (!message.includes("retrying")) {
              scheduleRetry();
            }
          },
        });

        readerRef.current = reader;
        window.setTimeout(() => {
          if (!cancelled && !receivedTrack) scheduleRetry();
        }, 6000);
      })
      .catch(() => {
        if (cancelled) return;
        setIsActive(false);
        onStatusChange?.({
          state: "starting",
          message: "WebRTC belum tersedia. HLS dipakai sebagai fallback.",
        });
        scheduleRetry();
      });

    return () => {
      cancelled = true;
      if (retryTimeout !== null) window.clearTimeout(retryTimeout);
      readerRef.current?.close();
      readerRef.current = null;
      video.pause();
      video.srcObject = null;
    };
  }, [onStatusChange, retryToken, url]);

  return (
    <video
      ref={videoRef}
      data-live-media="webrtc"
      className={cn(
        "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
        isActive ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      autoPlay={isPlaying}
      muted={isMuted}
      playsInline
    />
  );
}