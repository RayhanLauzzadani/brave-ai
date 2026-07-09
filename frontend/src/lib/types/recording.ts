// ==========================================
// BRAVE AI - Recording Types
// ==========================================

export type RecordingStatus = "tersimpan" | "ditinjau" | "terkunci";
export type RecordingStorageStatus = "available" | "unavailable";

export interface Recording {
  id: string;
  cameraId: string;
  cameraName: string;
  location: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  duration: number; // seconds
  fileUrl: string | null;
  fileSize: number; // bytes
  hasIncident: boolean;
  incidentCount: number;
  thumbnailUrl: string | null;
  status: RecordingStatus;
  storageStatus: RecordingStorageStatus;
  playbackUrl: string | null;
}

export interface EvidenceClipRequest {
  cameraId: string;
  startTime: string;
  endTime: string;
  reason?: string;
}

export interface EvidenceClipResponse {
  id: string;
  recordingId: string;
  cameraId: string;
  startTime: string;
  endTime: string;
  reason: string;
  clipUrl: string;
  status: "queued" | "processing" | "ready";
  createdAt: string;
}
export interface RecordingSegment {
  id: string;
  cameraId: string;
  mediaPath: string;
  filePath: string;
  mediaUrl: string | null;
  startTime: string;
  endTime: string;
  duration: number;
  fileSize: number;
}
