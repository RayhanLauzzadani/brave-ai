import type { Camera } from "@/lib/types";

export function normalizeMediaPath(value: string | null) {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!normalized) return null;

  const withoutManifest = normalized.endsWith("/index.m3u8")
    ? normalized.slice(0, -"/index.m3u8".length).replace(/^\/+|\/+$/g, "")
    : normalized;

  const safePath = withoutManifest
    .split("/")
    .map(slugifyMediaPath)
    .filter(Boolean)
    .join("/");

  return safePath || null;
}

export function extractMediaPathFromHlsUrl(value: string) {
  try {
    const url = new URL(value);
    return stripMediaGatewayPrefix(normalizeMediaPath(url.pathname), "hls");
  } catch {
    return null;
  }
}

export function getDevicePublisherMediaPath(camera: Camera, rawInput = "") {
  const input = rawInput.trim();
  if (input) {
    const inputPath = looksLikeUrl(input)
      ? extractMediaPathFromHlsUrl(input)
      : normalizeMediaPath(input);
    const cleanedInputPath = stripMediaGatewayPrefix(inputPath, "hls");
    if (cleanedInputPath) return cleanedInputPath;
  }

  if (camera.mediaPath) {
    const savedMediaPath = stripMediaGatewayPrefix(camera.mediaPath, "hls");
    if (savedMediaPath) return savedMediaPath;
  }

  const savedUrl = camera.liveHlsUrl ?? camera.streamUrl ?? "";
  const savedUrlPath = savedUrl && looksLikeUrl(savedUrl)
    ? extractMediaPathFromHlsUrl(savedUrl)
    : normalizeMediaPath(savedUrl);
  const cleanedSavedUrlPath = stripMediaGatewayPrefix(savedUrlPath, "hls");
  if (cleanedSavedUrlPath) return cleanedSavedUrlPath;

  const cameraKey = slugifyMediaPath(camera.id || camera.name).replace(/^cam-/, "");
  return `camera-${cameraKey}`;
}

export function buildGatewayHlsUrl(mediaPath: string | null) {
  if (!mediaPath) return "";
  const baseUrl = getGatewayHlsBaseUrl().replace(/\/+$/g, "");
  return `${baseUrl}/${encodeMediaPath(mediaPath)}/index.m3u8`;
}

export function buildGatewayWebRtcPublisherUrl(mediaPath: string) {
  const baseUrl = getGatewayWebRtcBaseUrl().replace(/\/+$/g, "");
  return `${baseUrl}/${encodeMediaPath(mediaPath)}/publish`;
}

export function buildGatewayWebRtcWhipUrl(mediaPath: string) {
  const baseUrl = getGatewayWebRtcBaseUrl().replace(/\/+$/g, "");
  return baseUrl + "/" + encodeMediaPath(mediaPath) + "/whip";
}

export function buildGatewayWebRtcReaderUrl(mediaPath: string) {
  const baseUrl = getGatewayWebRtcBaseUrl().replace(/\/+$/g, "");
  return `${baseUrl}/${encodeMediaPath(mediaPath)}/whep`;
}

export type GatewayPlaybackSpan = {
  start: string;
  duration: number;
};

export async function getGatewayPlaybackSpans(
  mediaPath: string,
  range?: { startTime?: string; endTime?: string },
): Promise<GatewayPlaybackSpan[]> {
  const baseUrl = getGatewayPlaybackBaseUrl().replace(/\/+$/g, "");
  const params = new URLSearchParams({ path: mediaPath });
  if (range?.startTime) params.set("start", new Date(range.startTime).toISOString());
  if (range?.endTime) params.set("end", new Date(range.endTime).toISOString());

  const response = await fetch(baseUrl + "/list?" + params.toString(), {
    cache: "no-store",
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error("Riwayat tayangan kamera belum dapat dimuat.");
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const start = "start" in item && typeof item.start === "string" ? item.start : "";
    const duration = "duration" in item && typeof item.duration === "number" ? item.duration : 0;
    if (!start || !Number.isFinite(duration) || duration <= 0) return [];
    return [{ start, duration }];
  });
}

export function buildGatewayPlaybackUrl(mediaPath: string, startTime: string, durationSeconds: number) {
  const baseUrl = getGatewayPlaybackBaseUrl().replace(/\/+$/g, "");
  const params = new URLSearchParams({
    path: mediaPath,
    start: new Date(startTime).toISOString(),
    duration: String(Math.max(1, Math.round(durationSeconds))),
    format: "fmp4",
  });
  return baseUrl + "/get?" + params.toString();
}
export function buildRaspberryPiInstallCommand(mediaPath: string) {
  const assetBase = getPiAssetBaseUrl();
  const rtspHost = getMediaGatewayHost();

  return [
    "curl -fsSL",
    shellQuote(`${assetBase}/install.sh`),
    "| sudo bash -s --",
    "--media-path",
    shellQuote(mediaPath),
    "--rtsp-host",
    shellQuote(rtspHost),
    "--asset-base",
    shellQuote(assetBase),
  ].join(" ");
}

export function getGatewayHlsBaseUrl() {
  if (process.env.NEXT_PUBLIC_MEDIA_HLS_BASE_URL) {
    return process.env.NEXT_PUBLIC_MEDIA_HLS_BASE_URL;
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (isLoopbackHost(host)) {
      return `${window.location.protocol}//${host}:8888`;
    }

    return `${window.location.origin}/hls`;
  }

  return "http://localhost:8888";
}

export function getGatewayPlaybackBaseUrl() {
  if (process.env.NEXT_PUBLIC_MEDIA_PLAYBACK_BASE_URL) {
    return process.env.NEXT_PUBLIC_MEDIA_PLAYBACK_BASE_URL;
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (isLoopbackHost(host)) {
      return window.location.protocol + "//" + host + ":9996";
    }

    return window.location.origin + "/playback";
  }

  return "http://localhost:9996";
}
export function getGatewayWebRtcBaseUrl() {
  if (process.env.NEXT_PUBLIC_MEDIA_WEBRTC_BASE_URL) {
    return process.env.NEXT_PUBLIC_MEDIA_WEBRTC_BASE_URL;
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (isLoopbackHost(host)) {
      return `${window.location.protocol}//${host}:8889`;
    }

    return `${window.location.origin}/webrtc`;
  }

  return "http://localhost:8889";
}

export function encodeMediaPath(mediaPath: string) {
  return mediaPath.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function getPiAssetBaseUrl() {
  if (process.env.NEXT_PUBLIC_PI_ASSET_BASE_URL) {
    return process.env.NEXT_PUBLIC_PI_ASSET_BASE_URL.replace(/\/+$/g, "");
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}/pi`;
  }

  return "https://brave-ai.web.id/pi";
}

function getMediaGatewayHost() {
  if (process.env.NEXT_PUBLIC_MEDIA_RTSP_HOST) {
    return process.env.NEXT_PUBLIC_MEDIA_RTSP_HOST;
  }

  if (typeof window !== "undefined") {
    return window.location.hostname;
  }

  return "brave-ai.web.id";
}

function looksLikeUrl(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function stripMediaGatewayPrefix(mediaPath: string | null, prefix: string) {
  if (!mediaPath) return null;
  const cleanPath = mediaPath.trim().replace(/^\/+|\/+$/g, "");
  if (!cleanPath || cleanPath === prefix) return null;
  return cleanPath.startsWith(`${prefix}/`) ? cleanPath.slice(prefix.length + 1) : cleanPath;
}

function slugifyMediaPath(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "camera";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isLoopbackHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}