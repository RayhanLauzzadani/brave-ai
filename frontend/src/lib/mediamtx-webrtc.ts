export type MediaMtxWebRtcReaderStatus = {
  state: "starting" | "active" | "error";
  message: string;
};

export type MediaMtxWebRtcReaderInstance = {
  close: () => void;
};

export type MediaMtxWebRtcReaderConstructor = new (config: {
  url: string;
  user?: string;
  pass?: string;
  token?: string;
  onError?: (message: string) => void;
  onTrack?: (event: RTCTrackEvent) => void;
  onDataChannel?: (event: RTCDataChannelEvent) => void;
}) => MediaMtxWebRtcReaderInstance;

declare global {
  interface Window {
    MediaMTXWebRTCReader?: MediaMtxWebRtcReaderConstructor;
  }
}

export async function loadMediaMtxWebRtcReader(): Promise<MediaMtxWebRtcReaderConstructor> {
  if (typeof window === "undefined") {
    throw new Error("WebRTC reader hanya tersedia di browser.");
  }

  if (!window.MediaMTXWebRTCReader) {
    await import("@/lib/vendor/mediamtx-webrtc-reader.js");
  }

  if (!window.MediaMTXWebRTCReader) {
    throw new Error("Reader WebRTC MediaMTX gagal dimuat.");
  }

  return window.MediaMTXWebRTCReader;
}