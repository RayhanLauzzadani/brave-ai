// ==========================================
// BRAVE AI - Cameras API
// FastAPI-backed camera data.
// ==========================================

import { Camera, CameraConnectionStatus, CameraSourceType, CameraSourceUpdate } from "@/lib/types";
import { apiClient } from "@/lib/api/client";

/** Get all cameras. */
export async function getCameras(): Promise<Camera[]> {
  return apiClient<Camera[]>("/cameras");
}

/** Create a new camera. */
export async function createCamera(payload: { name: string, location: string, isAiEnabled?: boolean, sourceType?: CameraSourceType }): Promise<Camera> {
  return apiClient<Camera>("/cameras", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Delete a camera. */
export async function deleteCamera(id: string): Promise<void> {
  return apiClient<void>(`/cameras/${id}`, {
    method: "DELETE",
  });
}

/** Update camera display details without changing its source configuration. */
export async function renameCamera(id: string, name: string, location: string): Promise<Camera> {
  return apiClient<Camera>(`/cameras/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name, location }),
  });
}

/** Check whether the Raspberry Pi is publishing to this camera channel. */
export async function getCameraConnectionStatus(id: string): Promise<CameraConnectionStatus> {
  return apiClient<CameraConnectionStatus>(`/cameras/${encodeURIComponent(id)}/connection`, {
    cache: "no-store",
  });
}
/** Get a single camera by ID. */
export async function getCameraById(id: string): Promise<Camera | undefined> {
  try {
    return await apiClient<Camera>(`/cameras/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
}

/** Update the playback source metadata for a camera slot. */
export async function updateCameraSource(
  id: string,
  payload: CameraSourceUpdate
): Promise<Camera> {
  return apiClient<Camera>(`/cameras/${encodeURIComponent(id)}/source`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
