import { apiClient } from "@/lib/api/client";
import type {
  IncidentReport,
  IncidentReportUpdate,
  ReportStatus,
} from "@/lib/types";

export async function getReports(options?: {
  status?: "all" | ReportStatus;
}): Promise<IncidentReport[]> {
  const params = new URLSearchParams();
  if (options?.status && options.status !== "all") {
    params.set("status", options.status);
  }
  const query = params.toString();
  return apiClient<IncidentReport[]>(`/reports${query ? `?${query}` : ""}`);
}

export async function getReport(reportId: string): Promise<IncidentReport> {
  return apiClient<IncidentReport>(`/reports/${encodeURIComponent(reportId)}`);
}

export async function updateReport(
  reportId: string,
  payload: IncidentReportUpdate,
): Promise<IncidentReport> {
  return apiClient<IncidentReport>(
    `/reports/${encodeURIComponent(reportId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}
