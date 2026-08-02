import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface NotificationPreferencesState {
  soundEnabled: boolean;
  hasHydrated: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useNotificationPreferencesStore =
  create<NotificationPreferencesState>()(
    persist(
      (set) => ({
        soundEnabled: true,
        hasHydrated: false,
        setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
        setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      }),
      {
        name: "brave-ai-notification-preferences",
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({ soundEnabled: state.soundEnabled }),
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true);
        },
      },
    ),
  );
