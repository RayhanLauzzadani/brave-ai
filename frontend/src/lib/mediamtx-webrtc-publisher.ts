export type MediaMtxWebRtcPublisherStatus = {
  state: "requesting" | "connecting" | "active" | "error";
  message: string;
};

export type MediaMtxWebRtcPublisherInstance = {
  close: () => void;
};

export type MediaMtxWebRtcPublisherConstructor = new (config: {
  url: string;
  user?: string;
  pass?: string;
  token?: string;
  stream: MediaStream;
  videoCodec: string;
  videoBitrate: number;
  audioCodec: string;
  audioBitrate: number;
  audioVoice: boolean;
  onError?: (message: string) => void;
  onConnected?: () => void;
}) => MediaMtxWebRtcPublisherInstance;

declare global {
  interface Window {
    MediaMTXWebRTCPublisher?: MediaMtxWebRtcPublisherConstructor;
  }
}

export async function loadMediaMtxWebRtcPublisher(): Promise<MediaMtxWebRtcPublisherConstructor> {
  if (typeof window === "undefined") {
    throw new Error("Publisher webcam hanya tersedia di browser.");
  }

  if (!window.MediaMTXWebRTCPublisher) {
    await import("@/lib/vendor/mediamtx-webrtc-publisher.js");
  }

  if (!window.MediaMTXWebRTCPublisher) {
    throw new Error("Publisher WebRTC MediaMTX gagal dimuat.");
  }

  return window.MediaMTXWebRTCPublisher;
}
