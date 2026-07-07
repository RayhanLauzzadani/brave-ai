// ==========================================
// BRAVE AI - Bullying Logs API
// FastAPI-backed incident activity data.
// ==========================================

import { BullyingLog, LogStatus } from "@/lib/types";
import { apiClient } from "@/lib/api/client";

/** Get all bullying logs, optionally filtered. */
export async function getBullyingLogs(filters?: {
  cameraId?: string;
  severity?: string;
  status?: string;
  bullyType?: string;
  recordingId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}): Promise<BullyingLog[]> {
  const params = new URLSearchParams();
  if (filters?.cameraId) params.set("cameraId", filters.cameraId);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.status && filters.status !== "all") params.set("status", filters.status);
  if (filters?.bullyType && filters.bullyType !== "all") params.set("bullyType", filters.bullyType);
  if (filters?.recordingId) params.set("recordingId", filters.recordingId);
  if (filters?.dateFrom ?? filters?.startDate) {
    params.set("dateFrom", filters.dateFrom ?? filters.startDate!);
  }
  if (filters?.dateTo ?? filters?.endDate) {
    params.set("dateTo", filters.dateTo ?? filters.endDate!);
  }
  if (filters?.search) params.set("search", filters.search);

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