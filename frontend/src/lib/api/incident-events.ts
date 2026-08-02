import { apiClient } from "@/lib/api/client";
import type {
  Alert,
  BullyingLog,
  BullySeverity,
  BullyType,
} from "@/lib/types";

export type IncidentEventPayload = {
  cameraId: string;
  cameraName: string;
  bullyType: BullyType;
  severity: BullySeverity;
  confidence: number;
  description: string;
  occurredAt?: string;
  thumbnailUrl?: string | null;
  recordingId?: string | null;
};

export type IncidentEventResult = {
  log: BullyingLog;
  alert: Alert;
};

export async function createIncidentEvent(
  payload: IncidentEventPayload,
): Promise<IncidentEventResult> {
  return apiClient<IncidentEventResult>("/incident-events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
