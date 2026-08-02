"use client";

import { useEffect, useRef } from "react";
import { buildGatewayWebRtcWhipUrl } from "@/lib/media-gateway";
import {
  loadMediaMtxWebRtcPublisher,
  type MediaMtxWebRtcPublisherInstance,
  type MediaMtxWebRtcPublisherStatus,
} from "@/lib/mediamtx-webrtc-publisher";

type LocalWebcamTestPublisherProps = {
  active: boolean;
  mediaPath: string;
  onStatusChange: (status: MediaMtxWebRtcPublisherStatus) => void;
};

export function LocalWebcamTestPublisher({
  active,
  mediaPath,
  onStatusChange,
}: LocalWebcamTestPublisherProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const statusCallbackRef = useRef(onStatusChange);

  useEffect(() => {
    statusCallbackRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    if (!active || !mediaPath) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let publisher: MediaMtxWebRtcPublisherInstance | null = null;
    const preview = videoRef.current;
    const publishStatus = (status: MediaMtxWebRtcPublisherStatus) => {
      if (!cancelled) statusCallbackRef.current(status);
    };

    const startPublisher = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        publishStatus({
          state: "error",
          message: "Browser ini belum mendukung akses webcam.",
        });
        return;
      }

      if (!window.isSecureContext) {
        publishStatus({
          state: "error",
          message: "Webcam hanya dapat diuji melalui HTTPS atau localhost.",
        });
        return;
      }

      publishStatus({ state: "requesting", message: "Meminta izin webcam..." });

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });

        if (cancelled) {
          stopStream(stream);
          return;
        }

        if (preview) {
          preview.srcObject = stream;
          await preview.play().catch(() => undefined);
        }

        publishStatus({
          state: "connecting",
          message: "Menghubungkan webcam ke kamera uji...",
        });

        const Publisher = await loadMediaMtxWebRtcPublisher();
        if (cancelled) return;

        publisher = new Publisher({
          url: buildGatewayWebRtcWhipUrl(mediaPath),
          stream,
          videoCodec: selectVideoCodec(),
          videoBitrate: 2500,
          audioCodec: "opus/48000",
          audioBitrate: 32,
          audioVoice: true,
          onConnected: () => {
            publishStatus({
              state: "active",
              message: "Webcam uji aktif dan sedang direkam.",
            });
          },
          onError: (message) => {
            publishStatus({
              state: message.toLowerCase().includes("bad status code 400")
                ? "error"
                : "connecting",
              message: getPublisherErrorMessage(message),
            });
          },
        });
      } catch (error) {
        publisher?.close();
        publisher = null;
        stopStream(stream);
        stream = null;
        if (preview) preview.srcObject = null;
        publishStatus({ state: "error", message: getWebcamErrorMessage(error) });
      }
    };

    void startPublisher();

    return () => {
      cancelled = true;
      publisher?.close();
      stopStream(stream);
      if (preview) preview.srcObject = null;
    };
  }, [active, mediaPath]);

  return (
    <video
      ref={videoRef}
      className="hidden"
      muted
      playsInline
      aria-hidden="true"
    />
  );
}

function selectVideoCodec() {
  const codecs = RTCRtpSender.getCapabilities?.("video")?.codecs ?? [];
  const preferredCodecs = ["video/H264", "video/VP9", "video/AV1"];

  for (const preferred of preferredCodecs) {
    const codec = codecs.find(
      (candidate) => candidate.mimeType.toLowerCase() === preferred.toLowerCase(),
    );
    if (codec) {
      return codec.mimeType.split("/")[1].toLowerCase() + "/" + codec.clockRate;
    }
  }

  throw new Error("Browser tidak menyediakan codec webcam yang kompatibel dengan HLS.");
}

function getPublisherErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("bad status code 400")) {
    return "Channel kamera sedang dipakai perangkat lain. Hentikan source tersebut lalu coba lagi.";
  }
  if (normalized.includes("peer connection closed")) {
    return "Koneksi webcam terputus. Mencoba menyambungkan kembali...";
  }
  return "Webcam belum tersambung ke gateway. Mencoba kembali...";
}

function getWebcamErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : "Webcam belum dapat digunakan.";
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Izin webcam ditolak. Izinkan kamera melalui pengaturan browser.";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "Webcam sedang dipakai aplikasi lain atau belum siap.";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "Webcam tidak ditemukan pada perangkat ini.";
  }
  return error.message || "Webcam belum dapat digunakan.";
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
