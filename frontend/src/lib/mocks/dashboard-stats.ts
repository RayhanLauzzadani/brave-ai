// ==========================================
// BRAVE AI — Mock Dashboard Stats
// ==========================================

export interface DashboardStats {
  totalCameras: number;
  camerasOnline: number;
  camerasOffline: number;
  camerasRecording: number;
  alertsToday: number;
  logsThisWeek: number;
  weeklyData: WeeklyDataPoint[];
}

export interface WeeklyDataPoint {
  day: string;
  incidents: number;
  physical: number;
  verbal: number;
  social: number;
}

export const mockDashboardStats: DashboardStats = {
  totalCameras: 4,
  camerasOnline: 2,
  camerasOffline: 1,
  camerasRecording: 1,
  alertsToday: 3,
  logsThisWeek: 8,
  weeklyData: [
    { day: "Sen", incidents: 2, physical: 1, verbal: 1, social: 0 },
    { day: "Sel", incidents: 1, physical: 0, verbal: 0, social: 1 },
    { day: "Rab", incidents: 3, physical: 2, verbal: 1, social: 0 },
    { day: "Kam", incidents: 0, physical: 0, verbal: 0, social: 0 },
    { day: "Jum", incidents: 4, physical: 2, verbal: 1, social: 1 },
    { day: "Sab", incidents: 1, physical: 1, verbal: 0, social: 0 },
    { day: "Min", incidents: 2, physical: 1, verbal: 0, social: 1 },
  ],
};
