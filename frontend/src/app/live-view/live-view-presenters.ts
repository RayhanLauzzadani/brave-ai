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

export const CAMERA_IMAGES = [
  "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1590402494682-cd3fb53b1f70?q=80&w=1200&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=1200&auto=format&fit=crop",
];

export const FALLBACK_CAMERAS: Camera[] = [
  {
    id: "cam-001",
    name: "Koridor Lantai 2",
    location: "Gedung A Lt. 2",
    status: "recording",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: CAMERA_IMAGES[0],
    lastActive: new Date().toISOString(),
    isAiEnabled: true,
  },
  {
    id: "cam-002",
    name: "Halaman Depan",
    location: "Gedung A Lt. 1",
    status: "online",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: CAMERA_IMAGES[1],
    lastActive: new Date().toISOString(),
    isAiEnabled: true,
  },
  {
    id: "cam-003",
    name: "Kantin Sekolah",
    location: "Gedung B Lt. 1",
    status: "online",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: CAMERA_IMAGES[2],
    lastActive: new Date().toISOString(),
    isAiEnabled: true,
  },
  {
    id: "cam-004",
    name: "Kelas IX B",
    location: "Gedung C Lt. 2",
    status: "offline",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: CAMERA_IMAGES[3],
    lastActive: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    isAiEnabled: false,
  },
];

export const FALLBACK_ACTIVITIES: ActivityItem[] = [
  {
    id: "fallback-activity-1",
    time: "10:05",
    date: "",
    loc: "Koridor Lantai 2",
    locationDetail: "Gedung A Lt. 2",
    title: "Indikasi verbal bullying",
    desc: "Terdengar kata-kata kasar",
    status: "Dalam Proses",
    color: "text-red-500",
    bg: "bg-red-50",
    badge: "bg-orange-50 text-orange-600 border border-orange-100",
  },
  {
    id: "fallback-activity-2",
    time: "09:30",
    date: "",
    loc: "Kelas IX B",
    locationDetail: "Gedung C Lt. 2",
    title: "Kerumunan terdeteksi",
    desc: "Kerumunan siswa di kelas",
    status: "Ditinjau",
    color: "text-blue-500",
    bg: "bg-blue-50",
    badge: "bg-blue-50 text-blue-600 border border-blue-100",
  },
  {
    id: "fallback-activity-3",
    time: "09:10",
    date: "",
    loc: "Kantin Sekolah",
    locationDetail: "Gedung B Lt. 1",
    title: "Dorongan antar siswa",
    desc: "Terjadi dorongan ringan",
    status: "Selesai",
    color: "text-emerald-500",
    bg: "bg-emerald-50",
    badge: "bg-emerald-50 text-emerald-600 border border-emerald-100",
  },
];

export const FALLBACK_RECORDINGS: QuickRecordingItem[] = [
  {
    id: "fallback-rec-1",
    title: "Koridor Lantai 2",
    time: "10:15 WIB",
    duration: "01:25",
    img: CAMERA_IMAGES[0],
  },
  {
    id: "fallback-rec-2",
    title: "Kelas IX B",
    time: "09:45 WIB",
    duration: "00:58",
    img: CAMERA_IMAGES[3],
  },
  {
    id: "fallback-rec-3",
    title: "Kantin Sekolah",
    time: "09:20 WIB",
    duration: "01:10",
    img: CAMERA_IMAGES[2],
  },
];

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
  }).format(date);
}

export function formatTime(value: Date | string | undefined) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDisplayDate(value: Date | string | undefined) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatMobileDate(value: Date | string | undefined) {
  const date = toDate(value);
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function toActivityItems(logs: BullyingLog[], fallback = FALLBACK_ACTIVITIES) {
  if (logs.length === 0) {
    return fallback.map((item, index) => {
      const timestamp = new Date(Date.now() - index * 35 * 60 * 1000);
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
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
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