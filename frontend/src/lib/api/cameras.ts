// ==========================================
// BRAVE AI - Cameras API
// FastAPI-backed camera data.
// ==========================================

import { Camera, CameraSourceUpdate } from "@/lib/types";
import { apiClient } from "@/lib/api/client";

/** Get all cameras. */
export async function getCameras(): Promise<Camera[]> {
  return apiClient<Camera[]>("/cameras");
}

/** Create a new camera. */
export async function createCamera(payload: { name: string, location: string, isAiEnabled?: boolean, sourceType?: string }): Promise<Camera> {
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
