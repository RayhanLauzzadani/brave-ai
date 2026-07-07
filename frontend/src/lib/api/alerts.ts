// ==========================================
// BRAVE AI - Alerts API
// FastAPI + WebSocket alert integration.
// ==========================================

import { Alert } from "@/lib/types";
import { apiClient, WS_URL } from "@/lib/api/client";

/** Get all alerts. */
export async function getAlerts(options?: {
  unreadOnly?: boolean;
}): Promise<Alert[]> {
  const params = new URLSearchParams();
  if (options?.unreadOnly) {
    params.set("unreadOnly", "true");
  }
  const query = params.toString();
  return apiClient<Alert[]>(`/alerts${query ? `?${query}` : ""}`);
}

/** Mark one alert as read. */
export async function markAlertRead(alertId: string): Promise<Alert> {
  return apiClient<Alert>("/alerts/mark-read", {
    method: "POST",
    body: JSON.stringify({ alertId }),
  });
}

/** Mark all alerts as read. */
export async function markAllAlertsRead(): Promise<Alert[]> {
  return apiClient<Alert[]>("/alerts/mark-all-read", {
    method: "POST",
  });
}

/** Subscribe to real-time alerts from FastAPI WebSocket. */
export function subscribeAlerts(
  onAlert: (alert: Alert) => void,
  onError?: (error: Event) => void
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const socket = new WebSocket(`${WS_URL}/alerts`);

  socket.onmessage = (event) => {
    try {
      onAlert(JSON.parse(event.data) as Alert);
    } catch {
      // Ignore malformed realtime payloads and keep the socket alive.
    }
  };

  socket.onerror = (event) => {
    onError?.(event);
  };

  return () => {
    socket.close();
  };
}