"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

export type LiveDvrPlaybackSource = {
  url: string;
  startTime: string;
  seekTime: string;
};

type LiveDvrPlaybackProps = {
  source: LiveDvrPlaybackSource;
  isPlaying: boolean;
  isMuted: boolean;
  onTimeChange?: (time: string) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
};

export function LiveDvrPlayback({
  source,
  isPlaying,
  isMuted,
  onTimeChange,
  onEnded,
  onError,
}: LiveDvrPlaybackProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [readySource, setReadySource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const isReady = readySource === source.url;
  const hasError = failedSource === source.url;

  useEffect(() => {
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
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const targetSeconds = getSeekOffsetSeconds(source);
    if (Math.abs(video.currentTime - targetSeconds) > 0.75) {
      video.currentTime = Math.min(targetSeconds, Math.max(0, video.duration - 0.1));
    }
  }, [source]);

  const seekToRequestedTime = (video: HTMLVideoElement) => {
    const targetSeconds = getSeekOffsetSeconds(source);
    video.currentTime = Math.min(targetSeconds, Math.max(0, video.duration - 0.1));
  };

  const publishCurrentTime = (video: HTMLVideoElement) => {
    const startTime = new Date(source.startTime).getTime();
    if (Number.isNaN(startTime)) return;
    onTimeChange?.(new Date(startTime + video.currentTime * 1000).toISOString());
  };

  return (
    <div className="absolute inset-0 z-10 bg-slate-950">
      <video
        ref={videoRef}
        data-live-media="dvr"
        src={source.url}
        className="h-full w-full object-cover"
        autoPlay={isPlaying}
        muted={isMuted}
        playsInline
        preload="auto"
        onLoadedMetadata={(event) => seekToRequestedTime(event.currentTarget)}
        onCanPlay={(event) => {
          setReadySource(source.url);
          setFailedSource(null);
          if (isPlaying) void event.currentTarget.play().catch(() => undefined);
        }}
        onTimeUpdate={(event) => publishCurrentTime(event.currentTarget)}
        onSeeked={(event) => publishCurrentTime(event.currentTarget)}
        onEnded={onEnded}
        onError={() => {
          const message = "Rekaman pada waktu ini belum siap. Kembali ke LIVE lalu coba lagi.";
          setFailedSource(source.url);
          setReadySource(null);
          onError?.(message);
        }}
      />

      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 px-6 text-center text-white">
          <div>
            {hasError ? (
              <RotateCcw className="mx-auto h-7 w-7 text-red-400" />
            ) : (
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-400" />
            )}
            <p className="mt-3 text-[12px] font-bold pwa:text-[13px]">
              {hasError ? "Rekaman belum dapat diputar" : "Memuat rekaman sebelumnya..."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function getSeekOffsetSeconds(source: LiveDvrPlaybackSource) {
  const startTime = new Date(source.startTime).getTime();
  const seekTime = new Date(source.seekTime).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(seekTime)) return 0;
  return Math.max(0, (seekTime - startTime) / 1000);
}
