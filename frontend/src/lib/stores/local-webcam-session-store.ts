import { create } from "zustand";
import type { MediaMtxWebRtcPublisherStatus } from "@/lib/mediamtx-webrtc-publisher";

interface LocalWebcamSessionState {
  cameraId: string | null;
  mediaPath: string | null;
  status: MediaMtxWebRtcPublisherStatus | null;
  start: (cameraId: string, mediaPath: string) => void;
  stop: () => void;
  setStatus: (status: MediaMtxWebRtcPublisherStatus) => void;
}

export const useLocalWebcamSessionStore = create<LocalWebcamSessionState>(
  (set) => ({
    cameraId: null,
    mediaPath: null,
    status: null,

    start: (cameraId, mediaPath) =>
      set({
        cameraId,
        mediaPath,
        status: {
          state: "requesting",
          message: "Meminta izin webcam...",
        },
      }),

    stop: () =>
      set({
        cameraId: null,
        mediaPath: null,
        status: null,
      }),

    setStatus: (status) => set({ status }),
  }),
);
