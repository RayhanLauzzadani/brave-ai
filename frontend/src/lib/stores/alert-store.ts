// ==========================================
// BRAVE AI - Alert Store (Zustand)
// ==========================================

import { create } from "zustand";
import { Alert } from "@/lib/types";

interface AlertState {
  alerts: Alert[];
  unreadCount: number;
  addAlert: (alert: Alert) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setAlerts: (alerts: Alert[]) => void;
  clearAlerts: () => void;
}

function sortAlerts(alerts: Alert[]) {
  return [...alerts].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function countUnread(alerts: Alert[]) {
  return alerts.filter((alert) => !alert.isRead).length;
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  unreadCount: 0,

  addAlert: (alert) =>
    set((state) => {
      const merged = sortAlerts([
        alert,
        ...state.alerts.filter((item) => item.id !== alert.id),
      ]).slice(0, 50);
      return {
        alerts: merged,
        unreadCount: countUnread(merged),
      };
    }),

  markRead: (id) =>
    set((state) => {
      const alerts = state.alerts.map((alert) =>
        alert.id === id ? { ...alert, isRead: true } : alert
      );
      return {
        alerts,
        unreadCount: countUnread(alerts),
      };
    }),

  markAllRead: () =>
    set((state) => {
      const alerts = state.alerts.map((alert) => ({ ...alert, isRead: true }));
      return {
        alerts,
        unreadCount: 0,
      };
    }),

  setAlerts: (alerts) => {
    const sorted = sortAlerts(alerts);
    set({
      alerts: sorted,
      unreadCount: countUnread(sorted),
    });
  },

  clearAlerts: () => set({ alerts: [], unreadCount: 0 }),
}));