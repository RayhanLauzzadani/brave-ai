// ==========================================
// BRAVE AI - Bullying Logs API
// FastAPI-backed incident activity data.
// ==========================================

import { BullyingLog, IncidentVerification, LogStatus } from "@/lib/types";
import { apiClient } from "@/lib/api/client";

/** Get all bullying logs, optionally filtered. */
export async function getBullyingLogs(filters?: {
  cameraId?: string;
  severity?: string;
  status?: string;
  recordingId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  verificationStatus?: "all" | IncidentVerification;
}): Promise<BullyingLog[]> {
  const params = new URLSearchParams();
  if (filters?.cameraId) params.set("cameraId", filters.cameraId);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.status && filters.status !== "all") params.set("status", filters.status);
  if (filters?.recordingId) params.set("recordingId", filters.recordingId);
  if (filters?.dateFrom ?? filters?.startDate) {
    params.set("dateFrom", filters.dateFrom ?? filters.startDate!);
  }
  if (filters?.dateTo ?? filters?.endDate) {
    params.set("dateTo", filters.dateTo ?? filters.endDate!);
  }
  if (filters?.search) params.set("search", filters.search);
  if (filters?.verificationStatus && filters.verificationStatus !== "all") {
    params.set("verificationStatus", filters.verificationStatus);
  }

  const query = params.toString();
  return apiClient<BullyingLog[]>(`/bullying-logs${query ? `?${query}` : ""}`);
}

/** Get a single bullying log by ID. */
export async function getBullyingLogById(
  id: string
): Promise<BullyingLog | undefined> {
  try {
    return await apiClient<BullyingLog>(`/bullying-logs/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
}

/** Update incident handling status. */
export async function updateBullyingLogStatus(
  id: string,
  status: LogStatus
): Promise<BullyingLog> {
  return apiClient<BullyingLog>(`/bullying-logs/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
/** Confirm whether an incoming indication is bullying or a false positive. */
export async function updateBullyingLogVerification(
  id: string,
  verification: Exclude<IncidentVerification, "pending">
): Promise<BullyingLog> {
  return apiClient<BullyingLog>(`/bullying-logs/${encodeURIComponent(id)}/verification`, {
    method: "PATCH",
    body: JSON.stringify({ verification }),
  });
}
