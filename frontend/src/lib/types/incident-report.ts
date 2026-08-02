export type ReportStatus = "draft" | "ditindaklanjuti" | "selesai";

export interface IncidentReport {
  id: string;
  logId: string;
  cameraId: string;
  cameraName: string;
  cameraLocation: string;
  incidentAt: string;
  confidence: number;
  aiReason: string;
  recordingId: string | null;
  title: string;
  chronology: string;
  handlingNotes: string;
  status: ReportStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentReportUpdate {
  title?: string;
  chronology?: string;
  handlingNotes?: string;
  status?: ReportStatus;
}
