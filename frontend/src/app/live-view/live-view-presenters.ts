import type { BullyingLog, Camera, Recording } from "@/lib/types";

export type ActivityItem = {
  id: string;
  time: string;
  date: string;
  loc: string;
  locationDetail: string;
  title: string;
  desc: string;
  status: string;
  color: string;
  bg: string;
  badge: string;
};

export type QuickRecordingItem = {
  id: string;
  title: string;
  time: string;
  duration: string;
  img: string;
};

export const LIVE_VIEW_INITIAL_TIME_ISO = "2026-07-07T03:00:00.000Z";
const FALLBACK_OFFLINE_TIME_ISO = "2026-07-07T01:00:00.000Z";
const FALLBACK_ACTIVITY_TIMES = [
  "2026-07-07T03:05:00.000Z",
  "2026-07-07T02:30:00.000Z",
  "2026-07-07T02:10:00.000Z",
];
const DISPLAY_TIME_ZONE = "Asia/Jakarta";

export const CAMERA_IMAGES = [
  "/thumbnails/cctv1.png",
  "/thumbnails/cctv2.png",
  "/thumbnails/cctv3.png",
  "/thumbnails/cctv4.png",
];

export const FALLBACK_CAMERAS: Camera[] = [];

export const FALLBACK_ACTIVITIES: ActivityItem[] = [];

export const FALLBACK_RECORDINGS: QuickRecordingItem[] = [];

export function isPlaceholderThumbnail(url?: string | null) {
  return !url || url.includes("cam-placeholder");
}

export function getCameraImage(camera: Camera | undefined, index = 0) {
  if (camera?.thumbnailUrl && !isPlaceholderThumbnail(camera.thumbnailUrl)) {
    return camera.thumbnailUrl;
  }
  return CAMERA_IMAGES[index % CAMERA_IMAGES.length];
}

export function isCameraOnline(camera: Camera | undefined) {
  return camera?.status !== "offline";
}

export function cameraStatusLabel(camera: Camera | undefined) {
  return isCameraOnline(camera) ? "Online" : "Offline";
}

export function formatClock(value: Date | string | undefined) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function formatTime(value: Date | string | undefined) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function formatDisplayDate(value: Date | string | undefined) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function formatMobileDate(value: Date | string | undefined) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function toActivityItems(logs: BullyingLog[], fallback = FALLBACK_ACTIVITIES) {
  if (logs.length === 0) {
    return fallback.map((item, index) => {
      const timestamp = FALLBACK_ACTIVITY_TIMES[index] ?? LIVE_VIEW_INITIAL_TIME_ISO;
      return {
        ...item,
        time: formatTime(timestamp),
        date: formatDisplayDate(timestamp),
      };
    });
  }

  return logs.slice(0, 3).map((log) => {
    const severity = getSeverityStyle(log.severity);
    return {
      id: log.id,
      time: formatTime(log.timestamp),
      date: formatDisplayDate(log.timestamp),
      loc: log.cameraName,
      locationDetail: "Area kamera terpilih",
      title: log.title,
      desc: log.description,
      status: getLogStatusText(log.status),
      color: severity.color,
      bg: severity.bg,
      badge: getLogStatusBadge(log.status),
    } satisfies ActivityItem;
  });
}

export function toQuickRecordingItems(recordings: Recording[]) {
  if (recordings.length === 0) return FALLBACK_RECORDINGS;
  return recordings.slice(0, 3).map((recording, index) => ({
    id: recording.id,
    title: recording.cameraName,
    time: `${formatTime(recording.startTime)} WIB`,
    duration: formatDuration(recording.duration),
    img: CAMERA_IMAGES[index % CAMERA_IMAGES.length],
  }));
}

function toDate(value: Date | string | undefined) {
  const date = value instanceof Date ? value : new Date(value ?? LIVE_VIEW_INITIAL_TIME_ISO);
  return Number.isNaN(date.getTime()) ? new Date(LIVE_VIEW_INITIAL_TIME_ISO) : date;
}

function getSeverityStyle(severity: BullyingLog["severity"]) {
  if (severity === "critical" || severity === "high") {
    return { color: "text-red-500", bg: "bg-red-50" };
  }
  if (severity === "medium") {
    return { color: "text-blue-500", bg: "bg-blue-50" };
  }
  return { color: "text-emerald-500", bg: "bg-emerald-50" };
}

function getLogStatusText(status: BullyingLog["status"]) {
  const labels: Record<BullyingLog["status"], string> = {
    "dalam-proses": "Dalam Proses",
    ditinjau: "Ditinjau",
    selesai: "Selesai",
    "prioritas-tinggi": "Prioritas Tinggi",
  };
  return labels[status];
}

function getLogStatusBadge(status: BullyingLog["status"]) {
  const badges: Record<BullyingLog["status"], string> = {
    "dalam-proses": "bg-orange-50 text-orange-600 border border-orange-100",
    ditinjau: "bg-blue-50 text-blue-600 border border-blue-100",
    selesai: "bg-emerald-50 text-emerald-600 border border-emerald-100",
    "prioritas-tinggi": "bg-orange-50 text-orange-600 border border-orange-100",
  };
  return badges[status];
}

function formatDuration(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const rest = Math.max(0, seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
