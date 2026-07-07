// ==========================================
// BRAVE AI — Camera Store (Zustand)
// ==========================================

import { create } from "zustand";

interface CameraState {
  selectedCameraId: string | null;
  setSelectedCamera: (id: string | null) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  selectedCameraId: null,
  setSelectedCamera: (id) => set({ selectedCameraId: id }),
}));
