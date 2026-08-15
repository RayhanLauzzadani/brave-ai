"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCw,
  Search,
  ShieldAlert,
  Video,
  X,
} from "lucide-react";
import { DashboardPageHeader } from "@/components/layout/dashboard-page-header";
import {
  getBullyingLogs,
  updateBullyingLogVerification,
} from "@/lib/api/bullying-logs";
import { compareEventsNewestFirst } from "@/lib/event-order";
import type { BullyingLog, IncidentVerification } from "@/lib/types";
import { cn } from "@/lib/utils";

type ReportView = "bullying" | "pending" | "not-bullying";

const VIEW_OPTIONS: Array<{
  value: ReportView;
  label: string;
  emptyTitle: string;
  emptyDescription: string;
}> = [
  {
    value: "bullying",
    label: "Bullying",
    emptyTitle: "Belum ada bullying terkonfirmasi",
    emptyDescription: "Indikasi yang dikonfirmasi pihak sekolah akan muncul di sini.",
  },
  {
    value: "pending",
    label: "Perlu Diperiksa",
    emptyTitle: "Semua indikasi sudah diperiksa",
    emptyDescription: "Indikasi baru dari kamera akan muncul di sini.",
  },
  {
    value: "not-bullying",
    label: "Bukan Bullying",
    emptyTitle: "Belum ada riwayat bukan bullying",
    emptyDescription: "Hasil pemeriksaan yang dinyatakan aman akan disimpan di sini.",
  },
];

export default function LaporanPage() {
  return (
    <Suspense fallback={<ReportLoadingState />}>
      <LaporanContent />
    </Suspense>
  );
}

function LaporanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryLogId = searchParams.get("logId");
  const queryRecordingId = searchParams.get("recordingId");

  const [logs, setLogs] = useState<BullyingLog[]>([]);
  const [view, setView] = useState<ReportView>("bullying");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatingLogId, setUpdatingLogId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getBullyingLogs({
        recordingId: queryRecordingId ?? undefined,
      });
      setLogs(result);

      const requestedLog = queryLogId
        ? result.find((log) => log.id === queryLogId)
        : null;
      if (requestedLog) {
        setView(toReportView(requestedLog.verificationStatus));
        window.setTimeout(() => {
          document
            .getElementById(`incident-${requestedLog.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 120);
      }
    } catch (error) {
      setLogs([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Laporan belum bisa dimuat. Coba beberapa saat lagi.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [queryLogId, queryRecordingId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadLogs();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadLogs]);

  const counts = useMemo(
    () => ({
      bullying: logs.filter((log) => log.verificationStatus === "bullying").length,
      pending: logs.filter((log) => log.verificationStatus === "pending").length,
      "not-bullying": logs.filter(
        (log) => log.verificationStatus === "not-bullying",
      ).length,
    }),
    [logs],
  );

  const visibleLogs = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("id-ID");
    return logs
      .filter((log) => log.verificationStatus === view)
      .filter((log) => {
        if (!term) return true;
        return [
          log.title,
          log.description,
          log.cameraName,
          log.cameraLocation,
        ].some((value) => value.toLocaleLowerCase("id-ID").includes(term));
      })
      .sort(compareEventsNewestFirst);
  }, [logs, search, view]);

  const selectedView =
    VIEW_OPTIONS.find((option) => option.value === view) ?? VIEW_OPTIONS[0];

  const verifyIncident = async (
    log: BullyingLog,
    verification: Exclude<IncidentVerification, "pending">,
  ) => {
    setUpdatingLogId(log.id);
    setFeedback(null);

    try {
      const updated = await updateBullyingLogVerification(log.id, verification);
      setLogs((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setView(toReportView(updated.verificationStatus));
      setFeedback({
        kind: "success",
        message:
          verification === "bullying"
            ? "Indikasi dikonfirmasi sebagai bullying dan masuk ke laporan."
            : "Indikasi disimpan sebagai bukan bullying.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Hasil pemeriksaan belum berhasil disimpan.",
      });
    } finally {
      setUpdatingLogId(null);
    }
  };

  const openIncident = (log: BullyingLog) => {
    const params = new URLSearchParams({
      cameraId: log.cameraId,
      logId: log.id,
      at: log.timestamp,
    });
    router.push(`/live-view?${params.toString()}`);
  };

  return (
    <div className="-m-4 min-h-screen bg-[#f4f7fb] p-4 pb-24 font-sans text-slate-900 pwa:-m-6 pwa:p-6 pwa:pb-6">
      <DashboardPageHeader
        title="Laporan"
        description="Periksa indikasi bullying dari kamera sekolah."
      />

      <div className="mx-auto max-w-7xl space-y-6">
        <div className="mb-6 flex flex-col gap-3 pwa:flex-row pwa:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400 pwa:left-4 pwa:h-5 pwa:w-5" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari kamera atau lokasi..."
              className="w-full rounded-full border border-slate-200/60 bg-white py-2.5 pl-10 pr-10 text-[13px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/15 pwa:rounded-xl pwa:border-slate-200 pwa:pl-10 pwa:text-sm pwa:shadow-sm pwa:focus:border-blue-500 pwa:focus:ring-1 pwa:focus:ring-blue-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Hapus pencarian"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 hide-scrollbar pwa:mx-0 pwa:items-center pwa:px-0 pwa:pb-0">
            {VIEW_OPTIONS.map((option) => {
              const isActive = option.value === view;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setView(option.value);
                    setFeedback(null);
                  }}
                  className={cn(
                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-[7px] text-[12px] font-semibold shadow-sm transition-colors pwa:rounded-xl pwa:px-4 pwa:py-2.5 pwa:text-sm",
                    isActive
                      ? "border-[#064eb7] bg-[#064eb7] text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {option.label}
                  <span
                    className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-bold",
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {counts[option.value]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm pwa:rounded-[24px]">
          <div className="flex items-center justify-between border-b-0 border-slate-100 p-4 pwa:border-b pwa:p-5">
            <div>
              <h2 className="text-[16px] font-bold text-[#1e293b] pwa:text-[18px]">
                {selectedView.label}
              </h2>
              <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                {counts[view]} kejadian
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadLogs()}
              className="flex items-center gap-0.5 rounded-lg bg-transparent px-1 py-1 text-[11px] font-medium text-blue-500 transition-colors hover:text-blue-600 pwa:border pwa:border-slate-100 pwa:bg-slate-50 pwa:px-3 pwa:py-1.5 pwa:text-sm pwa:text-slate-500 pwa:hover:text-slate-800"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5 pwa:h-4 pwa:w-4",
                  isLoading && "animate-spin",
                )}
              />
              Muat Ulang
            </button>
          </div>

          <div className="flex flex-col px-0 pb-0">
            {feedback && (
              <div
                className={cn(
                  "m-4 flex items-start gap-3 rounded-xl border p-4 text-[12px] font-semibold",
                  feedback.kind === "success"
                    ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                    : "border-red-100 bg-red-50 text-red-700",
                )}
              >
                {feedback.kind === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
            )}

            {loadError ? (
              <div className="m-0 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-red-700 pwa:m-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">Laporan gagal dimuat</p>
                  <p className="mt-1 text-xs leading-relaxed">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => void loadLogs()}
                    className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold transition-colors hover:bg-red-100"
                  >
                    Coba Lagi
                  </button>
                </div>
              </div>
            ) : isLoading ? (
              <div className="p-4 text-sm font-medium text-slate-500 pwa:p-6">
                Memuat laporan...
              </div>
            ) : visibleLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-slate-100 bg-slate-50">
                  <ShieldAlert className="h-7 w-7 text-slate-400" />
                </div>
                <h3 className="mb-1.5 text-[14px] font-bold text-[#1e293b] pwa:text-[15px]">
                  {search ? "Hasil tidak ditemukan" : selectedView.emptyTitle}
                </h3>
                <p className="max-w-[300px] text-[12px] font-medium text-slate-500 pwa:text-[13px]">
                  {search
                    ? "Coba gunakan nama kamera atau lokasi yang berbeda."
                    : selectedView.emptyDescription}
                </p>
              </div>
            ) : (
              visibleLogs.map((log) => (
                <IncidentRow
                  key={log.id}
                  log={log}
                  isRequested={log.id === queryLogId}
                  isUpdating={updatingLogId === log.id}
                  onOpen={() => openIncident(log)}
                  onVerify={(verification) =>
                    void verifyIncident(log, verification)
                  }
                />
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 p-3 pwa:p-5">
            <span className="text-xs font-medium text-slate-500">
              Menampilkan {visibleLogs.length} dari {counts[view]} kejadian
            </span>
            <span className="hidden text-xs font-semibold text-slate-400 pwa:block">
              {selectedView.label}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

function IncidentRow({
  log,
  isRequested,
  isUpdating,
  onOpen,
  onVerify,
}: {
  log: BullyingLog;
  isRequested: boolean;
  isUpdating: boolean;
  onOpen: () => void;
  onVerify: (verification: Exclude<IncidentVerification, "pending">) => void;
}) {
  const status = getStatusPresentation(log.verificationStatus);
  const incidentCopy = getIncidentCopy(log.verificationStatus);

  return (
    <div
      id={`incident-${log.id}`}
      className={cn(
        "flex flex-col gap-3 border-b border-slate-100 p-4 transition-colors last:border-0 hover:bg-slate-50 pwa:flex-row pwa:items-center pwa:gap-4",
        isRequested && "border-b-blue-200 bg-blue-50/50",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 pwa:gap-4">
        <div
          className={cn(
            "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[8px] pwa:h-12 pwa:w-12 pwa:rounded-xl",
            status.iconClass,
          )}
        >
          {log.verificationStatus === "bullying" ? (
            <ShieldAlert className="h-5 w-5" />
          ) : log.verificationStatus === "not-bullying" ? (
            <Check className="h-5 w-5" />
          ) : (
            <AlertTriangle className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold",
                status.badgeClass,
              )}
            >
              {status.label}
            </span>
            <span className="text-[10px] font-semibold text-slate-400">
              Keyakinan AI {formatConfidence(log.confidence)}
            </span>
          </div>

          <h3 className="mt-2 text-[13px] font-bold text-[#1e293b] pwa:text-[15px]">
            {incidentCopy.title}
          </h3>
          <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-slate-500 pwa:text-xs">
            {incidentCopy.description}
          </p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] font-medium text-slate-500 pwa:text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <Video className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{log.cameraName}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">
                {log.cameraLocation || "Lokasi belum tersedia"}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              {formatIncidentTime(log.timestamp)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 pwa:justify-end pwa:gap-2 pwa:border-0 pwa:pt-0">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-blue-200 bg-white px-3 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-50 pwa:flex-none pwa:rounded-lg pwa:text-xs"
        >
          <Video className="h-3.5 w-3.5" />
          Lihat Rekaman
        </button>

        {log.verificationStatus === "pending" && (
          <>
            <button
              type="button"
              onClick={() => onVerify("not-bullying")}
              disabled={isUpdating}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 pwa:flex-none pwa:rounded-lg pwa:text-xs"
            >
              <X className="h-3.5 w-3.5" />
              Bukan Bullying
            </button>
            <button
              type="button"
              onClick={() => onVerify("bullying")}
              disabled={isUpdating}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-red-500 bg-red-500 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-wait disabled:opacity-60 pwa:flex-none pwa:rounded-lg pwa:text-xs"
            >
              {isUpdating ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              Bullying
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReportLoadingState() {
  return (
    <div className="-m-4 flex min-h-screen items-center justify-center bg-[#f4f7fb] p-4 text-[13px] font-semibold text-slate-500 pwa:-m-6">
      Memuat laporan...
    </div>
  );
}

function toReportView(verification: IncidentVerification): ReportView {
  return verification;
}

function formatConfidence(confidence: number) {
  const normalized = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(normalized)}%`;
}

function formatIncidentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

function getStatusPresentation(verification: IncidentVerification) {
  if (verification === "bullying") {
    return {
      label: "Bullying",
      iconClass: "bg-red-50 text-red-600",
      badgeClass: "border-red-100 bg-red-50 text-red-700",
    };
  }
  if (verification === "not-bullying") {
    return {
      label: "Bukan Bullying",
      iconClass: "bg-emerald-50 text-emerald-600",
      badgeClass: "border-emerald-100 bg-emerald-50 text-emerald-700",
    };
  }
  return {
    label: "Perlu Diperiksa",
    iconClass: "bg-amber-50 text-amber-600",
    badgeClass: "border-amber-100 bg-amber-50 text-amber-700",
  };
}

function getIncidentCopy(verification: IncidentVerification) {
  if (verification === "bullying") {
    return {
      title: "Bullying fisik terkonfirmasi",
      description: "Pihak sekolah telah mengonfirmasi kejadian ini sebagai bullying.",
    };
  }
  if (verification === "not-bullying") {
    return {
      title: "Bukan bullying",
      description: "Kejadian telah diperiksa dan dinyatakan bukan bullying.",
    };
  }
  return {
    title: "Indikasi bullying fisik",
    description: "Periksa rekaman pada waktu kejadian sebelum menentukan hasilnya.",
  };
}
