// ==========================================
// BRAVE AI - Recordings API
// Minimal helpers used by Live View.
// ==========================================

import {
  EvidenceClipRequest,
  EvidenceClipResponse,
  Recording,
} from "@/lib/types";
import { apiClient } from "@/lib/api/client";

/** Get recordings with optional filters. */
export async function getRecordings(filters?: {
  cameraId?: string;
  dateFrom?: string;
  dateTo?: string;
  hasIncident?: boolean;
  status?: string;
  search?: string;
}): Promise<Recording[]> {
  const params = new URLSearchParams();
  if (filters?.cameraId) params.set("cameraId", filters.cameraId);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters?.search) params.set("search", filters.search);
  if (typeof filters?.hasIncident === "boolean") {
    params.set("hasIncident", String(filters.hasIncident));
  }

  const query = params.toString();
  return apiClient<Recording[]>(`/recordings${query ? `?${query}` : ""}`);
}

/** Get one recording by ID. */
export async function getRecordingById(
  id: string
): Promise<Recording | undefined> {
  try {
    return await apiClient<Recording>(`/recordings/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
}

/** Queue an evidence clip export. */
export async function createEvidenceClip(
  recordingId: string,
  request: EvidenceClipRequest
): Promise<EvidenceClipResponse> {
  return apiClient<EvidenceClipResponse>(
    `/recordings/${encodeURIComponent(recordingId)}/clips`,
    {
      method: "POST",
      body: JSON.stringify(request),
    }
  );
}