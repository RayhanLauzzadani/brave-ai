// ==========================================
// BRAVE AI - Camera Types
// ==========================================

export type CameraStatus = "online" | "offline" | "recording";
export type CameraSourceType =
  | "mock"
  | "local-webcam"
  | "phone-webcam"
  | "hls"
  | "direct-video"
  | "webrtc"
  | "rtsp"
  | "nvr";

export interface Camera {
  id: string;
  name: string;
  location: string;
  status: CameraStatus;
  streamUrl: string | null;
  sourceType: CameraSourceType;
  thumbnailUrl: string | null;
  lastActive: string; // ISO 8601
  isAiEnabled: boolean;
}

export interface CameraSourceUpdate {
  sourceType: CameraSourceType;
  streamUrl: string | null;
  thumbnailUrl?: string | null;
}
