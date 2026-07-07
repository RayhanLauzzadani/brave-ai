// ==========================================
// BRAVE AI — Auth Store (Zustand)
// ==========================================

import { create } from "zustand";
import { User } from "@/lib/types";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: (user, token) =>
    set({ user, token, isAuthenticated: true, isLoading: false }),

  logout: () =>
    set({ user: null, token: null, isAuthenticated: false }),

  setLoading: (isLoading) => set({ isLoading }),
}));
