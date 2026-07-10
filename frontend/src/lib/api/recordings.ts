// ==========================================
// BRAVE AI - Recordings API
// Minimal helpers used by Live View and Recording View.
// ==========================================

import {
  EvidenceClipRequest,
  EvidenceClipResponse,
  Recording,
  RecordingSegment,
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
  offset?: number;
  limit?: number;
}): Promise<Recording[]> {
  const params = new URLSearchParams();
  if (filters?.cameraId) params.set("cameraId", filters.cameraId);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters?.search) params.set("search", filters.search);
  if (typeof filters?.offset === "number") params.set("offset", String(filters.offset));
  if (typeof filters?.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters?.hasIncident === "boolean") {
    params.set("hasIncident", String(filters.hasIncident));
  }

  const query = params.toString();
  return apiClient<Recording[]>(`/recordings${query ? `?${query}` : ""}`);
}

/** List MediaMTX recording segments discovered by the backend. */
export async function getRecordingSegments(filters?: {
  cameraId?: string;
  mediaPath?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<RecordingSegment[]> {
  const params = new URLSearchParams();
  if (filters?.cameraId) params.set("cameraId", filters.cameraId);
  if (filters?.mediaPath) params.set("mediaPath", filters.mediaPath);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);

  const query = params.toString();
  return apiClient<RecordingSegment[]>(`/recordings/segments${query ? `?${query}` : ""}`);
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

/** List evidence clips queued/exported for a recording. */
export async function getEvidenceClips(
  recordingId: string
): Promise<EvidenceClipResponse[]> {
  return apiClient<EvidenceClipResponse[]>(
    `/recordings/${encodeURIComponent(recordingId)}/clips`
  );
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