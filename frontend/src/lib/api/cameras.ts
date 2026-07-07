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
