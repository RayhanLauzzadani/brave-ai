// ==========================================
// BRAVE AI — Bullying Log Types
// ==========================================

export type BullySeverity = "low" | "medium" | "high" | "critical";
export type BullyType = "physical";
export type LogStatus = "dalam-proses" | "selesai" | "ditinjau" | "prioritas-tinggi";
export type IncidentVerification = "pending" | "bullying" | "not-bullying";

export interface TimelineEvent {
  title: string;
  description: string;
  timestamp: string; // ISO 8601
  status: "completed" | "current" | "pending";
}

export interface BullyingLog {
  id: string;
  cameraId: string;
  cameraName: string;
  cameraLocation: string;
  recordingId: string | null;
  reportId: string | null;
  title: string;
  timestamp: string; // ISO 8601
  severity: BullySeverity;
  bullyType: BullyType;
  description: string;
  confidence: number; // 0.0 - 1.0
  thumbnailUrl: string | null;
  status: LogStatus;
  verificationStatus: IncidentVerification;
  verifiedBy: string | null;
  verifiedAt: string | null;
  pelapor: string;
  terkaitRekaman: string;
  timeline: TimelineEvent[];
}
