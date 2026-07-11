"use client";

import { useEffect, useRef, useState } from "react";
import { VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";

type RecordingPreviewProps = {
  src: string | null;
  label: string;
  unavailable?: boolean;
  eager?: boolean;
  className?: string;
};

export function RecordingPreview({
  src,
  label,
  unavailable = false,
  eager = false,
  className,
}: RecordingPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const [readySource, setReadySource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    if (eager || shouldLoad || !rootRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "240px" }
    );

    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [eager, shouldLoad]);

  const isReady = Boolean(src) && readySource === src;
  const hasError = Boolean(src) && failedSource === src;
  const canLoad = Boolean(src) && !unavailable && !hasError;

  return (
    <div ref={rootRef} className={cn("relative h-full w-full overflow-hidden bg-slate-950", className)}>
      {canLoad && shouldLoad && (
        <video
          src={src ?? undefined}
          aria-label={`Preview rekaman ${label}`}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-200",
            isReady ? "opacity-100" : "opacity-0"
          )}
          muted
          playsInline
          preload="auto"
          onLoadedData={(event) => {
            event.currentTarget.pause();
            setReadySource(src);
          }}
          onError={() => setFailedSource(src)}
        />
      )}

      {(!canLoad || !shouldLoad || !isReady) && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-400">
          <VideoOff className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}