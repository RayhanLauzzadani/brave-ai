import { create } from "zustand";
import type { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasHydrated: boolean;
  login: (user: User) => void;
  restoreSession: (user: User | null) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  hasHydrated: false,

  login: (user) =>
    set({
      user,
      isAuthenticated: true,
      isLoading: false,
      hasHydrated: true,
    }),

  restoreSession: (user) =>
    set({
      user,
      isAuthenticated: Boolean(user),
      isLoading: false,
      hasHydrated: true,
    }),

  logout: () =>
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      hasHydrated: true,
    }),

  setLoading: (isLoading) => set({ isLoading }),
}));
