// ==========================================
// BRAVE AI — Mock Camera Data
// ==========================================

import { Camera } from "@/lib/types";

export const mockCameras: Camera[] = [
  {
    id: "cam-001",
    name: "Koridor Lantai 1",
    location: "Gedung A — Lantai 1",
    status: "online",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: "/images/cam-placeholder.svg",
    lastActive: new Date().toISOString(),
    isAiEnabled: true,
  },
  {
    id: "cam-002",
    name: "Halaman Depan",
    location: "Area Terbuka — Depan",
    status: "recording",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: "/images/cam-placeholder.svg",
    lastActive: new Date().toISOString(),
    isAiEnabled: true,
  },
  {
    id: "cam-003",
    name: "Kantin Sekolah",
    location: "Gedung B — Lantai 1",
    status: "online",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: "/images/cam-placeholder.svg",
    lastActive: new Date().toISOString(),
    isAiEnabled: true,
  },
  {
    id: "cam-004",
    name: "Lapangan Olahraga",
    location: "Area Terbuka — Belakang",
    status: "offline",
    streamUrl: null,
    sourceType: "mock",
    thumbnailUrl: "/images/cam-placeholder.svg",
    lastActive: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    isAiEnabled: false,
  },
];
