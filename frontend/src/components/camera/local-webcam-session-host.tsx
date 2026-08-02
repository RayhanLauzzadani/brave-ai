"use client";

import { useEffect } from "react";
import { LocalWebcamTestPublisher } from "@/components/camera/local-webcam-test-publisher";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useLocalWebcamSessionStore } from "@/lib/stores/local-webcam-session-store";

export function LocalWebcamSessionHost() {
  const cameraId = useLocalWebcamSessionStore((state) => state.cameraId);
  const mediaPath = useLocalWebcamSessionStore((state) => state.mediaPath);
  const setStatus = useLocalWebcamSessionStore((state) => state.setStatus);
  const stop = useLocalWebcamSessionStore((state) => state.stop);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    if (hasHydrated && !isAuthenticated && cameraId) {
      stop();
    }
  }, [cameraId, hasHydrated, isAuthenticated, stop]);

  if (!cameraId || !mediaPath) return null;

  return (
    <LocalWebcamTestPublisher
      active
      mediaPath={mediaPath}
      onStatusChange={setStatus}
    />
  );
}
