// ==========================================
// BRAVE AI — Alert Types
// ==========================================

export type AlertType = "bullying_detected" | "camera_offline" | "camera_online" | "system";
export type AlertPriority = "low" | "medium" | "high" | "critical";

export interface Alert {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  cameraId: string | null;
  cameraName: string | null;
  title: string;
  message: string;
  timestamp: string; // ISO 8601
  isRead: boolean;
  metadata?: Record<string, unknown>;
}
