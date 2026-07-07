// ==========================================
// BRAVE AI — Mock Bullying Log Data
// ==========================================

import { BullyingLog } from "@/lib/types";

const now = Date.now();
const hour = 60 * 60 * 1000;
const minute = 60 * 1000;

export const mockBullyingLogs: BullyingLog[] = [
  {
    id: "log-001",
    cameraId: "cam-001",
    cameraName: "Koridor Lantai 2",
    recordingId: "rec-001",
    title: "Verbal bullying terhadap siswa kelas IX",
    timestamp: new Date(now - 1 * hour - 23 * minute).toISOString(),
    severity: "medium",
    bullyType: "verbal",
    description: "Terjadi ejekan dan kata-kata kasar terhadap salah satu siswa di depan kelas. Kejadian terekam kamera dan memerlukan tindak lanjut guru BK.",
    confidence: 0.87,
    thumbnailUrl: "https://images.unsplash.com/photo-1577896851231-70ef18881754?q=80&w=600&auto=format&fit=crop",
    status: "dalam-proses",
    pelapor: "Admin Sekolah",
    terkaitRekaman: "Koridor Lantai 2 / 02:45",
    timeline: [
      {
        title: "Laporan dibuat",
        description: "oleh Admin Sekolah",
        timestamp: new Date(now - 1 * hour - 23 * minute).toISOString(),
        status: "completed"
      },
      {
        title: "Bukti ditinjau",
        description: "oleh Wakil Kepala Sekolah",
        timestamp: new Date(now - 1 * hour - 8 * minute).toISOString(),
        status: "completed"
      },
      {
        title: "Menunggu tindak lanjut",
        description: "Menunggu penugasan guru BK",
        timestamp: new Date(now - 1 * hour - 8 * minute).toISOString(),
        status: "current"
      }
    ]
  },
  {
    id: "log-002",
    cameraId: "cam-002",
    cameraName: "Kantin Sekolah",
    recordingId: "rec-002",
    title: "Dorongan antar siswa saat antrean",
    timestamp: new Date(now - 3 * hour - 45 * minute).toISOString(),
    severity: "low",
    bullyType: "physical",
    description: "Terjadi insiden saling dorong di area kantin karena masalah antrean. Sudah diselesaikan di tempat.",
    confidence: 0.72,
    thumbnailUrl: "https://images.unsplash.com/photo-1522661067900-ab8288517c07?q=80&w=600&auto=format&fit=crop",
    status: "selesai",
    pelapor: "Petugas Kantin",
    terkaitRekaman: "Kantin Sekolah / 01:12",
    timeline: [
      {
        title: "Laporan dibuat",
        description: "oleh Petugas Kantin",
        timestamp: new Date(now - 3 * hour - 45 * minute).toISOString(),
        status: "completed"
      },
      {
        title: "Selesai ditangani",
        description: "oleh Guru Piket",
        timestamp: new Date(now - 3 * hour).toISOString(),
        status: "completed"
      }
    ]
  },
  {
    id: "log-003",
    cameraId: "cam-003",
    cameraName: "Kelas IX A",
    recordingId: "rec-003",
    title: "Pengucilan siswa saat diskusi kelompok",
    timestamp: new Date(now - 5 * hour).toISOString(),
    severity: "low",
    bullyType: "social",
    description: "Terekam salah satu siswa dipisahkan secara paksa dari kelompoknya dan dibiarkan menyendiri.",
    confidence: 0.94,
    thumbnailUrl: "https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=600&auto=format&fit=crop",
    status: "ditinjau",
    pelapor: "AI Sistem",
    terkaitRekaman: "Kelas IX A / 05:30",
    timeline: [
      {
        title: "Laporan otomatis dibuat",
        description: "oleh AI Sistem",
        timestamp: new Date(now - 5 * hour).toISOString(),
        status: "completed"
      },
      {
        title: "Dalam peninjauan",
        description: "oleh Guru BK",
        timestamp: new Date(now - 2 * hour).toISOString(),
        status: "current"
      }
    ]
  },
  {
    id: "log-004",
    cameraId: "cam-004",
    cameraName: "Halaman Depan",
    recordingId: "rec-004",
    title: "Intimidasi verbal oleh kelompok siswa",
    timestamp: new Date(now - 24 * hour).toISOString(),
    severity: "critical",
    bullyType: "verbal",
    description: "Kelompok siswa memojokkan satu siswa baru di gerbang depan, terindikasi ancaman verbal.",
    confidence: 0.88,
    thumbnailUrl: "https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?q=80&w=600&auto=format&fit=crop",
    status: "prioritas-tinggi",
    pelapor: "Saksi (Siswa)",
    terkaitRekaman: "Halaman Depan / 01:58",
    timeline: [
      {
        title: "Laporan dibuat",
        description: "oleh Saksi (Siswa)",
        timestamp: new Date(now - 24 * hour).toISOString(),
        status: "completed"
      },
      {
        title: "Menunggu penanganan darurat",
        description: "Eskalasi ke Kepala Sekolah",
        timestamp: new Date(now - 23 * hour).toISOString(),
        status: "current"
      }
    ]
  },
  {
    id: "log-005",
    cameraId: "cam-005",
    cameraName: "Lapangan",
    recordingId: "rec-005",
    title: "Pengambilan barang tanpa izin",
    timestamp: new Date(now - 48 * hour).toISOString(),
    severity: "medium",
    bullyType: "physical",
    description: "Tas siswa dilempar dan diambil paksa oleh sekelompok kakak kelas.",
    confidence: 0.95,
    thumbnailUrl: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=600&auto=format&fit=crop",
    status: "selesai",
    pelapor: "Admin Sekolah",
    terkaitRekaman: "Lapangan / 03:15",
    timeline: [
      {
        title: "Laporan dibuat",
        description: "oleh Admin Sekolah",
        timestamp: new Date(now - 48 * hour).toISOString(),
        status: "completed"
      },
      {
        title: "Selesai ditangani",
        description: "Barang dikembalikan, orangtua dipanggil",
        timestamp: new Date(now - 45 * hour).toISOString(),
        status: "completed"
      }
    ]
  }
];
