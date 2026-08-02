"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  CameraOff,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Info,
  Loader2,
  MapPin,
  Maximize,
  Minimize,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Signal,
  Terminal,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  EMPTY_LIVE_BUFFER,
  LiveCameraPlayer,
  type LiveBufferState,
  type LiveCameraPlayerStatus,
} from "@/components/camera/live-camera-player";
import { DashboardPageHeader } from "@/components/layout/dashboard-page-header";
import {
  VideoTrimmerModal,
  type VideoTrimExportPayload,
} from "@/components/ui/video-trimmer-modal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getBullyingLogs, updateBullyingLogVerification } from "@/lib/api/bullying-logs";
import {
  createCamera,
  deleteCamera,
  getCameraConnectionStatus,
  getCameras,
  renameCamera,
} from "@/lib/api/cameras";
import {
  createEvidenceClip,
  downloadEvidenceClip,
  getRecordingSegments,
  waitForEvidenceClip,
} from "@/lib/api/recordings";
import {
  buildGatewayHlsUrl,
  buildGatewayPlaybackUrl,
  buildRaspberryPiInstallCommand,
  getGatewayPlaybackSpans,
  type GatewayPlaybackSpan,
} from "@/lib/media-gateway";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useCameraStore } from "@/lib/stores/camera-store";
import { useLocalWebcamSessionStore } from "@/lib/stores/local-webcam-session-store";
import type {
  Alert,
  BullyingLog,
  Camera as CameraType,
  Recording,
  RecordingSegment,
} from "@/lib/types";
import type { IncidentVerification } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  formatClock,
  formatDisplayDate,
  getCameraImage,
} from "./live-view-presenters";

type CameraAvailability = "checking" | "live" | "offline" | "waiting";

const LIVE_PLAYBACK_WINDOW_SECONDS = 10 * 60;
const DVR_LIVE_EDGE_THRESHOLD_SECONDS = 3;
const DVR_PLAYBACK_START_GUARD_MS = 250;
// HLS publishes its live edge in segment-sized steps. Replay UI therefore
// keeps a stable lag from LIVE instead of following every manifest refresh.
const LOCAL_WEBCAM_TEST_ENABLED = process.env.NODE_ENV !== "production";

type CameraForm = {
  name: string;
  location: string;
};

type TimelineIncidentMarker = {
  id: string;
  title: string;
  timestamp: string;
  severity: BullyingLog["severity"];
  verificationStatus: IncidentVerification;
  positionSeconds: number;
  percent: number;
};

const EMPTY_CAMERA_FORM: CameraForm = { name: "", location: "" };

export default function LiveCameraDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryCameraId = searchParams.get("cameraId");
  const queryLogId = searchParams.get("logId");
  const user = useAuthStore((state) => state.user);
  const alerts = useAlertStore((state) => state.alerts);
  const unreadCount = useAlertStore((state) => state.unreadCount);
  const selectedCameraId = useCameraStore((state) => state.selectedCameraId);
  const setSelectedCameraId = useCameraStore((state) => state.setSelectedCamera);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const selectedCameraIdRef = useRef<string | null>(selectedCameraId);
  const focusedQueryLogRef = useRef<string | null>(null);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [logs, setLogs] = useState<BullyingLog[]>([]);
  const [availability, setAvailability] = useState<Record<string, CameraAvailability>>({});
  const [playerStatus, setPlayerStatus] = useState<LiveCameraPlayerStatus>({
    state: "idle",
    message: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [quality, setQuality] = useState<"HD" | "SD">("HD");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activatingCameraId, setActivatingCameraId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [actionMessage, setActionMessage] = useState("");
  const [cameraRecordings, setCameraRecordings] = useState<Recording[]>([]);
  const [playbackSpans, setPlaybackSpans] = useState<GatewayPlaybackSpan[]>([]);
  const [liveBuffer, setLiveBuffer] = useState<LiveBufferState>(EMPTY_LIVE_BUFFER);
  const [timeshiftBehindSeconds, setTimeshiftBehindSeconds] = useState<number | null>(null);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);
  const [scrubPositionSeconds, setScrubPositionSeconds] = useState<number | null>(null);
  const [scrubWindowDurationSeconds, setScrubWindowDurationSeconds] = useState(0);
  const scrubPositionRef = useRef<number | null>(null);
  const scrubRangeRef = useRef<{ duration: number; start: number; end: number } | null>(null);
  const stableDvrBehindRef = useRef<number | null>(null);
  const timeshiftBehindRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const [stableDvrBehindSeconds, setStableDvrBehindSeconds] = useState<number | null>(null);
  const [clipRecord, setClipRecord] = useState<Recording | null>(null);
  const [clipEventLog, setClipEventLog] = useState<BullyingLog | null>(null);
  const [isClipViewerOpen, setIsClipViewerOpen] = useState(false);
  const [isLoadingClip, setIsLoadingClip] = useState(false);
  const webcamTestCameraId = useLocalWebcamSessionStore((state) => state.cameraId);
  const webcamTestStatus = useLocalWebcamSessionStore((state) => state.status);
  const startWebcamTestSession = useLocalWebcamSessionStore((state) => state.start);
  const stopWebcamTestSession = useLocalWebcamSessionStore((state) => state.stop);
  const [verifyingLogId, setVerifyingLogId] = useState<string | null>(null);

  const [isAddCameraOpen, setIsAddCameraOpen] = useState(false);
  const [cameraForm, setCameraForm] = useState<CameraForm>(EMPTY_CAMERA_FORM);
  const [createdCamera, setCreatedCamera] = useState<CameraType | null>(null);
  const [isSubmittingCamera, setIsSubmittingCamera] = useState(false);
  const [cameraFormError, setCameraFormError] = useState("");
  const [commandCopied, setCommandCopied] = useState(false);
  const [cameraToRename, setCameraToRename] = useState<CameraType | null>(null);
  const [cameraNameDraft, setCameraNameDraft] = useState("");
  const [cameraLocationDraft, setCameraLocationDraft] = useState("");
  const [cameraRenameError, setCameraRenameError] = useState("");
  const [isRenamingCamera, setIsRenamingCamera] = useState(false);
  const [cameraToDelete, setCameraToDelete] = useState<CameraType | null>(null);
  const [isDeletingCamera, setIsDeletingCamera] = useState(false);

  const canManageCameras = user?.role === "admin";

  useEffect(() => {
    selectedCameraIdRef.current = selectedCameraId;
  }, [selectedCameraId]);

  useEffect(() => {
    if (
      !queryCameraId
      || !cameras.some((camera) => camera.id === queryCameraId)
      || selectedCameraId === queryCameraId
    ) {
      return;
    }
    setSelectedCameraId(queryCameraId);
  }, [cameras, queryCameraId, selectedCameraId, setSelectedCameraId]);

  useEffect(() => {
    timeshiftBehindRef.current = timeshiftBehindSeconds;
  }, [timeshiftBehindSeconds]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const loadLiveData = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setLoadError("");
    }

    try {
      const [cameraResult, logResult] = await Promise.all([
        getCameras(),
        getBullyingLogs(),
      ]);

      setCameras(cameraResult);
      setLogs(logResult);

      const currentSelectedId = selectedCameraIdRef.current;
      const nextSelectedId =
        currentSelectedId && cameraResult.some((camera) => camera.id === currentSelectedId)
          ? currentSelectedId
          : cameraResult[0]?.id ?? null;
      setSelectedCameraId(nextSelectedId);
      setLoadError("");
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Data kamera belum dapat dimuat."
      );
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [setSelectedCameraId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadLiveData(), 0);
    const interval = window.setInterval(() => void loadLiveData(true), 20_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadLiveData]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const latestIncidentAlertId = alerts.find((alert) => alert.type === "bullying_detected")?.id ?? null;

  useEffect(() => {
    if (!latestIncidentAlertId) return;

    const refresh = window.setTimeout(() => void loadLiveData(true), 0);
    return () => window.clearTimeout(refresh);
  }, [latestIncidentAlertId, loadLiveData]);

  useEffect(() => {
    if (!actionMessage) return;
    const timeout = window.setTimeout(() => setActionMessage(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [actionMessage]);

  useEffect(() => {
    if (cameras.length === 0) return;

    let cancelled = false;
    const checkAllCameras = async () => {
      setAvailability((current) => {
        const next = { ...current };
        cameras.forEach((camera) => {
          if (!next[camera.id]) next[camera.id] = "checking";
        });
        return next;
      });

      const results = await Promise.all(
        cameras.map(async (camera) => [camera.id, await checkCameraAvailability(camera)] as const)
      );

      if (!cancelled) {
        setAvailability(Object.fromEntries(results));
      }
    };

    const initialCheck = window.setTimeout(() => void checkAllCameras(), 0);
    const interval = window.setInterval(() => void checkAllCameras(), 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
    };
  }, [cameras]);

  const selectedCamera = useMemo(() => {
    const camera = cameras.find((item) => item.id === selectedCameraId) ?? cameras[0];
    return camera ? withPlayableSource(camera) : undefined;
  }, [cameras, selectedCameraId]);
  const selectedCameraIdForRecordings = selectedCamera?.id ?? null;
  const selectedMediaPathForRecordings = selectedCamera?.mediaPath ?? null;
  const selectedCameraNameForRecordings = selectedCamera?.name ?? "Kamera";
  const selectedCameraLocationForRecordings = selectedCamera?.location ?? "-";
  useEffect(() => {
    const resetTimeout = window.setTimeout(() => {
      setIsClipViewerOpen(false);
      setClipRecord(null);
      setClipEventLog(null);
      scrubRangeRef.current = null;
      scrubPositionRef.current = null;
      setIsScrubbingTimeline(false);
      setScrubPositionSeconds(null);
      setScrubWindowDurationSeconds(0);
      stableDvrBehindRef.current = null;
      timeshiftBehindRef.current = null;
      setStableDvrBehindSeconds(null);
      setTimeshiftBehindSeconds(null);
      setLiveBuffer(EMPTY_LIVE_BUFFER);
      setCameraRecordings([]);
      setPlaybackSpans([]);
    }, 0);

    if (!selectedCameraIdForRecordings) {
      return () => window.clearTimeout(resetTimeout);
    }

    let cancelled = false;
    const loadCameraRecordings = async () => {
      try {
        const rangeEnd = new Date();
        const rangeStart = new Date(rangeEnd.getTime() - LIVE_PLAYBACK_WINDOW_SECONDS * 1000);
        const [segmentResult, spanResult] = await Promise.all([
          getRecordingSegments({
            cameraId: selectedCameraIdForRecordings,
            dateFrom: rangeStart.toISOString(),
            dateTo: rangeEnd.toISOString(),
          }),
          selectedMediaPathForRecordings
            ? getGatewayPlaybackSpans(selectedMediaPathForRecordings, {
                startTime: rangeStart.toISOString(),
                endTime: rangeEnd.toISOString(),
              }).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (!cancelled) {
          setCameraRecordings(recordingSegmentsToLiveRecords(segmentResult, {
            id: selectedCameraIdForRecordings,
            name: selectedCameraNameForRecordings,
            location: selectedCameraLocationForRecordings,
          }));
          setPlaybackSpans(spanResult);
        }
      } catch {
        if (!cancelled) {
          setCameraRecordings([]);
          setPlaybackSpans([]);
        }
      }
    };

    void loadCameraRecordings();
    const interval = window.setInterval(() => void loadCameraRecordings(), 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(resetTimeout);
      window.clearInterval(interval);
    };
  }, [
    selectedCameraIdForRecordings,
    selectedCameraLocationForRecordings,
    selectedCameraNameForRecordings,
    selectedMediaPathForRecordings,
  ]);


  const selectedCameraHasSource = Boolean(selectedCamera?.streamUrl);
  const getEffectiveCameraAvailability = (cameraId: string): CameraAvailability => {
    if (cameraId === webcamTestCameraId && webcamTestStatus) {
      if (webcamTestStatus.state === "active") return "live";
      if (webcamTestStatus.state === "error") return "waiting";
      return "checking";
    }
    return availability[cameraId] ?? "checking";
  };
  const selectedCameraAvailability = selectedCamera
    ? getEffectiveCameraAvailability(selectedCamera.id)
    : "waiting";
  const selectedCameraGatewayReady = selectedCameraAvailability === "live";
  const selectedCameraIsLive = playerStatus.state === "active";
  const isTimeshifted = timeshiftBehindSeconds !== null;
  const playerCanInteract = selectedCameraIsLive || isTimeshifted;
  const playerIsPlaying = playerCanInteract && isPlaying;
  const dvrWindowDurationSeconds = Math.max(0, liveBuffer.duration);
  const rawDvrBehindSeconds = isTimeshifted
    ? clampNumber(liveBuffer.behindLive, 0, dvrWindowDurationSeconds)
    : 0;
  const dvrTimelineBehindSeconds = isTimeshifted
    ? clampNumber(
        stableDvrBehindSeconds ?? timeshiftBehindSeconds ?? rawDvrBehindSeconds,
        0,
        dvrWindowDurationSeconds,
      )
    : 0;
  const dvrSliderPositionSeconds = isTimeshifted
    ? Math.max(0, dvrWindowDurationSeconds - dvrTimelineBehindSeconds)
    : dvrWindowDurationSeconds;
  const timelineDurationSeconds = isScrubbingTimeline && scrubWindowDurationSeconds > 0
    ? scrubWindowDurationSeconds
    : dvrWindowDurationSeconds;
  const displayedDvrSliderPositionSeconds = isScrubbingTimeline && scrubPositionSeconds !== null
    ? clampNumber(scrubPositionSeconds, 0, timelineDurationSeconds)
    : dvrSliderPositionSeconds;
  const dvrProgressPercent = timelineDurationSeconds > 0
    ? Math.min(100, Math.max(0, (displayedDvrSliderPositionSeconds / timelineDurationSeconds) * 100))
    : 100;
  const dvrBehindLiveSeconds = isTimeshifted || isScrubbingTimeline
    ? Math.max(0, timelineDurationSeconds - displayedDvrSliderPositionSeconds)
    : 0;
  const dvrCanSeek =
    playerCanInteract
    && liveBuffer.available
    && dvrWindowDurationSeconds > DVR_LIVE_EDGE_THRESHOLD_SECONDS;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setIsPlaying(true);
      setPlayerStatus({
        state: selectedCameraHasSource && selectedCameraGatewayReady ? "starting" : "offline",
        message: selectedCameraHasSource && selectedCameraGatewayReady
          ? "Menghubungkan kamera..."
          : "Menunggu Raspberry Pi terhubung.",
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [selectedCamera?.id, selectedCameraGatewayReady, selectedCameraHasSource]);

  const handlePlayerStatus = useCallback((status: LiveCameraPlayerStatus) => {
    setPlayerStatus(status);
    const cameraId = selectedCameraIdRef.current;
    if (!cameraId) return;

    if (status.state === "active") {
      setAvailability((current) => ({ ...current, [cameraId]: "live" }));
      return;
    }

    if (["offline", "error", "stopped", "missing"].includes(status.state)) {
      setAvailability((current) => ({ ...current, [cameraId]: "offline" }));
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await videoContainerRef.current?.requestFullscreen().catch(() => undefined);
      return;
    }
    await document.exitFullscreen().catch(() => undefined);
  };

  const handleReturnToLive = useCallback(() => {
    scrubRangeRef.current = null;
    scrubPositionRef.current = null;
    stableDvrBehindRef.current = null;
    timeshiftBehindRef.current = null;
    isPlayingRef.current = true;
    setIsScrubbingTimeline(false);
    setScrubPositionSeconds(null);
    setScrubWindowDurationSeconds(0);
    setStableDvrBehindSeconds(null);
    setTimeshiftBehindSeconds(null);
    setIsPlaying(true);
    setActionMessage("Kembali ke tayangan langsung.");
  }, []);

  const handleLiveBufferChange = useCallback((buffer: LiveBufferState) => {
    const isReplay = timeshiftBehindRef.current !== null;
    const rawBehindLive = clampNumber(
      buffer.behindLive,
      0,
      Math.max(0, buffer.duration),
    );

    if (!isReplay) {
      if (stableDvrBehindRef.current !== null) {
        stableDvrBehindRef.current = null;
        setStableDvrBehindSeconds(null);
      }
    } else if (buffer.available) {
      const previousBehindLive = stableDvrBehindRef.current;
      const nextBehindLive =
        previousBehindLive === null || !isPlayingRef.current
          ? rawBehindLive
          : previousBehindLive;

      stableDvrBehindRef.current = nextBehindLive;
      setStableDvrBehindSeconds((current) => (
        current !== null && Math.abs(current - nextBehindLive) < 0.02
          ? current
          : nextBehindLive
      ));
    }

    setLiveBuffer((current) => {
      const isSamePosition =
        current.available === buffer.available
        && Math.abs(current.start - buffer.start) < 0.02
        && Math.abs(current.end - buffer.end) < 0.02
        && Math.abs(current.current - buffer.current) < 0.02;

      return isSamePosition ? current : buffer;
    });
  }, []);

  const beginDvrSeek = () => {
    if (!dvrCanSeek) return;

    scrubRangeRef.current = {
      duration: liveBuffer.duration,
      start: liveBuffer.start,
      end: liveBuffer.end,
    };
    scrubPositionRef.current = dvrSliderPositionSeconds;
    setScrubPositionSeconds(dvrSliderPositionSeconds);
    setScrubWindowDurationSeconds(liveBuffer.duration);
    setIsScrubbingTimeline(true);
  };

  const updateDvrSeek = (positionSeconds: number) => {
    const durationSeconds = scrubRangeRef.current?.duration ?? liveBuffer.duration;
    if (durationSeconds <= 0) return;

    const nextPosition = clampNumber(positionSeconds, 0, durationSeconds);
    scrubPositionRef.current = nextPosition;
    setScrubPositionSeconds(nextPosition);
  };

  const commitDvrSeek = (positionSeconds?: number) => {
    const scrubRange = scrubRangeRef.current;
    if (!scrubRange) return;

    const safePosition = clampNumber(
      positionSeconds ?? scrubPositionRef.current ?? scrubPositionSeconds ?? dvrSliderPositionSeconds,
      0,
      scrubRange.duration,
    );
    const behindLiveSeconds = Math.max(0, scrubRange.duration - safePosition);

    scrubRangeRef.current = null;
    scrubPositionRef.current = null;
    setIsScrubbingTimeline(false);
    setScrubPositionSeconds(null);
    setScrubWindowDurationSeconds(0);

    if (behindLiveSeconds <= DVR_LIVE_EDGE_THRESHOLD_SECONDS) {
      handleReturnToLive();
      return;
    }

    stableDvrBehindRef.current = behindLiveSeconds;
    timeshiftBehindRef.current = behindLiveSeconds;
    isPlayingRef.current = true;
    setStableDvrBehindSeconds(behindLiveSeconds);
    setTimeshiftBehindSeconds(behindLiveSeconds);
    setIsPlaying(true);
    setActionMessage(
      "Memutar " + formatDvrOffset(behindLiveSeconds) + " sebelum tayangan langsung.",
    );
  };

  const cancelDvrSeek = () => {
    scrubRangeRef.current = null;
    scrubPositionRef.current = null;
    setIsScrubbingTimeline(false);
    setScrubPositionSeconds(null);
    setScrubWindowDurationSeconds(0);
  };

  const handleTimelineMarkerClick = (marker: TimelineIncidentMarker) => {
    if (!dvrCanSeek || timelineDurationSeconds <= 0) return;

    const safePosition = clampNumber(marker.positionSeconds, 0, timelineDurationSeconds);
    scrubRangeRef.current = {
      duration: timelineDurationSeconds,
      start: liveBuffer.start,
      end: liveBuffer.end,
    };
    scrubPositionRef.current = safePosition;
    commitDvrSeek(safePosition);
  };

  const selectedStatus = getSelectedStatus({
    hasCamera: Boolean(selectedCamera),
    hasSource: selectedCameraHasSource,
    playerStatus,
    isPlaying,
    isTimeshifted,
  });

  const connectedCameraCount = cameras.filter(
    (camera) => getEffectiveCameraAvailability(camera.id) === "live",
  ).length;
  const unresolvedLogByCameraId = useMemo(() => {
    const result = new Map<string, BullyingLog>();
    logs.forEach((log) => {
      if (isVerificationPending(log.verificationStatus) && !result.has(log.cameraId)) {
        result.set(log.cameraId, log);
      }
    });
    return result;
  }, [logs]);

  const queriedLog = useMemo(
    () => logs.find((log) => log.id === queryLogId) ?? null,
    [logs, queryLogId],
  );
  const visibleLogs = useMemo(() => {
    const cameraLogs = selectedCamera
      ? logs.filter((log) => log.cameraId === selectedCamera.id)
      : logs;
    if (!queriedLog || !cameraLogs.some((log) => log.id === queriedLog.id)) {
      return cameraLogs.slice(0, 5);
    }
    return [
      queriedLog,
      ...cameraLogs.filter((log) => log.id !== queriedLog.id),
    ].slice(0, 5);
  }, [logs, queriedLog, selectedCamera]);

  const timelineIncidentMarkers = useMemo<TimelineIncidentMarker[]>(() => {
    if (!selectedCamera || !liveBuffer.available || timelineDurationSeconds <= 0) {
      return [];
    }

    const liveEdgeAt = liveBuffer.liveEdgeAt || now.getTime();
    const markerWindowSeconds = timelineDurationSeconds + 5;

    return logs
      .filter((log) => log.cameraId === selectedCamera.id)
      .flatMap((log) => {
        const occurredAt = new Date(log.timestamp).getTime();
        if (!Number.isFinite(occurredAt)) return [];

        const behindLiveSeconds = (liveEdgeAt - occurredAt) / 1000;
        if (behindLiveSeconds < -5 || behindLiveSeconds > markerWindowSeconds) {
          return [];
        }

        const positionSeconds = clampNumber(
          timelineDurationSeconds - behindLiveSeconds,
          0,
          timelineDurationSeconds,
        );

        return [{
          id: log.id,
          title: log.title,
          timestamp: log.timestamp,
          severity: log.severity,
          verificationStatus: log.verificationStatus,
          positionSeconds,
          percent: (positionSeconds / timelineDurationSeconds) * 100,
        }];
      })
      .sort((left, right) => left.positionSeconds - right.positionSeconds)
      .slice(-24);
  }, [liveBuffer.available, liveBuffer.liveEdgeAt, logs, now, selectedCamera, timelineDurationSeconds]);

  const openHistoricalIncidentPlayback = useCallback(async (log: BullyingLog) => {
    if (!selectedCamera || selectedCamera.id !== log.cameraId) return;

    const incidentAt = new Date(log.timestamp);
    if (Number.isNaN(incidentAt.getTime())) {
      setActionMessage("Waktu indikasi tidak valid.");
      return;
    }

    const reviewHalfWindowMs = (LIVE_PLAYBACK_WINDOW_SECONDS * 1000) / 2;
    const rangeStart = new Date(incidentAt.getTime() - reviewHalfWindowMs);
    const rangeEnd = new Date(
      Math.min(Date.now(), incidentAt.getTime() + reviewHalfWindowMs),
    );

    setIsLoadingClip(true);
    setActionMessage("Memuat rekaman di sekitar waktu indikasi...");
    try {
      const [segments, spans] = await Promise.all([
        getRecordingSegments({
          cameraId: selectedCamera.id,
          dateFrom: rangeStart.toISOString(),
          dateTo: rangeEnd.toISOString(),
        }),
        selectedCamera.mediaPath
          ? getGatewayPlaybackSpans(selectedCamera.mediaPath, {
              startTime: rangeStart.toISOString(),
              endTime: rangeEnd.toISOString(),
            }).catch(() => [])
          : Promise.resolve([]),
      ]);
      const recordings = recordingSegmentsToLiveRecords(segments, selectedCamera);
      const reviewRecord = createLivePlaybackRecord(
        selectedCamera,
        recordings,
        spans,
        log.timestamp,
      );

      if (!reviewRecord) {
        setActionMessage(
          "Rekaman indikasi belum tersedia atau sudah melewati masa simpan 7 hari.",
        );
        return;
      }

      setClipRecord(reviewRecord);
      setClipEventLog(log);
      setIsClipViewerOpen(true);
      setActionMessage("Rekaman indikasi berhasil dimuat.");
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Rekaman indikasi belum dapat dimuat.",
      );
    } finally {
      setIsLoadingClip(false);
    }
  }, [selectedCamera]);

  useEffect(() => {
    if (!queryLogId || focusedQueryLogRef.current === queryLogId) return;
    if (!queriedLog || selectedCamera?.id !== queriedLog.cameraId) return;

    const marker = timelineIncidentMarkers.find((item) => item.id === queryLogId);
    if (!marker) {
      focusedQueryLogRef.current = queryLogId;
      const timeout = window.setTimeout(() => {
        void openHistoricalIncidentPlayback(queriedLog);
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    focusedQueryLogRef.current = queryLogId;
    const frame = window.requestAnimationFrame(() => {
      const markerButton = document
        .querySelector<HTMLElement>(
          `[data-live-incident-marker="${CSS.escape(queryLogId)}"]`,
        );
      markerButton?.click();
      markerButton?.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    openHistoricalIncidentPlayback,
    queriedLog,
    queryLogId,
    selectedCamera,
    timelineIncidentMarkers,
  ]);

  const selectedOpenLog = selectedCamera
    ? unresolvedLogByCameraId.get(selectedCamera.id) ?? null
    : null;
  const raspberryPiCommand = useMemo(() => {
    if (!createdCamera) return "";
    return buildRaspberryPiInstallCommand(createdCamera.mediaPath ?? createdCamera.id);
  }, [createdCamera]);

  const handleOpenAddCamera = () => {
    setCameraForm(EMPTY_CAMERA_FORM);
    setCreatedCamera(null);
    setCameraFormError("");
    setCommandCopied(false);
    setIsAddCameraOpen(true);
  };

  const handleOpenRaspberryPiCommand = (camera: CameraType) => {
    setCameraForm(EMPTY_CAMERA_FORM);
    setCreatedCamera(camera);
    setCameraFormError("");
    setCommandCopied(false);
    setIsAddCameraOpen(true);
  };
  const closeAddCamera = () => {
    setIsAddCameraOpen(false);
    setCameraForm(EMPTY_CAMERA_FORM);
    setCreatedCamera(null);
    setCameraFormError("");
    setCommandCopied(false);
  };

  const handleAddCamera = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = cameraForm.name.trim();
    const location = cameraForm.location.trim();
    if (!name || !location) {
      setCameraFormError("Nama kamera dan lokasi perlu diisi.");
      return;
    }

    setIsSubmittingCamera(true);
    setCameraFormError("");
    try {
      const camera = await createCamera({
        name,
        location,
        isAiEnabled: true,
        sourceType: "hls",
      });
      setCreatedCamera(camera);
      setCameras((current) => [camera, ...current.filter((item) => item.id !== camera.id)]);
      setAvailability((current) => ({ ...current, [camera.id]: "waiting" }));
      setSelectedCameraId(camera.id);
    } catch (error) {
      setCameraFormError(
        error instanceof Error ? error.message : "Kamera belum berhasil ditambahkan."
      );
    } finally {
      setIsSubmittingCamera(false);
    }
  };

  const handleCopyRaspberryPiCommand = async () => {
    if (!raspberryPiCommand) return false;
    try {
      await navigator.clipboard.writeText(raspberryPiCommand);
      setCommandCopied(true);
      setCameraFormError("");
      return true;
    } catch {
      setCameraFormError("Command belum dapat disalin. Pilih command lalu salin secara manual.");
      return false;
    }
  };

  const handleCopyCommandAndClose = async () => {
    const copied = await handleCopyRaspberryPiCommand();
    if (copied) closeAddCamera();
  };

  const handleActivateCamera = async (camera: CameraType | undefined = selectedCamera) => {
    if (!camera) return;

    setActivatingCameraId(camera.id);
    setActionMessage("Memeriksa koneksi Raspberry Pi...");
    try {
      const connection = await getCameraConnectionStatus(camera.id);
      const nextAvailability: CameraAvailability = connection.connected
        ? "live"
        : connection.status === "waiting"
          ? "waiting"
          : "offline";

      setAvailability((current) => ({
        ...current,
        [camera.id]: nextAvailability,
      }));
      setActionMessage(connection.message);

      if (camera.id === selectedCameraIdRef.current) {
        setPlayerStatus({
          state: connection.connected ? "starting" : "offline",
          message: connection.message,
        });
      }
    } catch (error) {
      setAvailability((current) => ({ ...current, [camera.id]: "offline" }));
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Koneksi Raspberry Pi belum dapat diperiksa."
      );
    } finally {
      setActivatingCameraId(null);
    }
  };

  const handleStartWebcamTest = () => {
    if (!selectedCamera?.mediaPath) {
      setActionMessage("Channel kamera belum tersedia untuk pengujian webcam.");
      return;
    }

    startWebcamTestSession(selectedCamera.id, selectedCamera.mediaPath);
    setAvailability((current) => ({ ...current, [selectedCamera.id]: "checking" }));
    setActionMessage("Izinkan webcam untuk memulai pengujian kamera.");
  };

  const handleStopWebcamTest = () => {
    const cameraId = webcamTestCameraId;
    stopWebcamTestSession();
    if (cameraId) {
      setAvailability((current) => ({ ...current, [cameraId]: "waiting" }));
      if (cameraId === selectedCameraIdRef.current) {
        setPlayerStatus({
          state: "offline",
          message: "Webcam uji dihentikan. Menunggu Raspberry Pi terhubung.",
        });
      }
    }
    setActionMessage("Webcam uji dihentikan. Rekaman yang sudah terbentuk tetap tersimpan.");
  };

  const handleDeleteCamera = async () => {
    if (!cameraToDelete) return;
    setIsDeletingCamera(true);
    try {
      await deleteCamera(cameraToDelete.id);
      if (cameraToDelete.id === webcamTestCameraId) {
        stopWebcamTestSession();
      }
      const remaining = cameras.filter((camera) => camera.id !== cameraToDelete.id);
      setCameras(remaining);
      if (selectedCameraIdRef.current === cameraToDelete.id) {
        setSelectedCameraId(remaining[0]?.id ?? null);
      }
      setCameraToDelete(null);
      setActionMessage("Kamera berhasil dihapus.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Kamera belum dapat dihapus.");
    } finally {
      setIsDeletingCamera(false);
    }
  };

  const openRenameCamera = (camera: CameraType) => {
    setCameraToRename(camera);
    setCameraNameDraft(camera.name);
    setCameraLocationDraft(camera.location);
    setCameraRenameError("");
  };

  const closeRenameCamera = () => {
    if (isRenamingCamera) return;
    setCameraToRename(null);
    setCameraNameDraft("");
    setCameraLocationDraft("");
    setCameraRenameError("");
  };

  const handleRenameCamera = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cameraToRename) return;

    const name = cameraNameDraft.trim();
    const location = cameraLocationDraft.trim();
    if (!name) {
      setCameraRenameError("Nama kamera tidak boleh kosong.");
      return;
    }
    if (!location) {
      setCameraRenameError("Lokasi kamera tidak boleh kosong.");
      return;
    }
    if (name === cameraToRename.name && location === cameraToRename.location) {
      closeRenameCamera();
      return;
    }

    setIsRenamingCamera(true);
    setCameraRenameError("");
    try {
      const renamedCamera = await renameCamera(cameraToRename.id, name, location);
      setCameras((current) =>
        current.map((camera) =>
          camera.id === renamedCamera.id ? renamedCamera : camera
        )
      );
      setCameraToRename(null);
      setCameraNameDraft("");
      setCameraLocationDraft("");
      setActionMessage("Nama dan lokasi kamera berhasil diubah.");
    } catch (error) {
      setCameraRenameError(
        error instanceof Error
          ? error.message
          : "Nama kamera belum berhasil diubah."
      );
    } finally {
      setIsRenamingCamera(false);
    }
  };

  const handleAlertClick = async (alert: Alert) => {
    const logId = typeof alert.metadata?.logId === "string" ? alert.metadata.logId : null;
    const params = new URLSearchParams();
    if (alert.cameraId) params.set("cameraId", alert.cameraId);
    if (logId) params.set("logId", logId);
    params.set("at", alert.timestamp);
    router.push("/live-view?" + params.toString());
  };

  const handleOpenLog = (log: BullyingLog) => {
    setSelectedCameraId(log.cameraId);
    router.push(
      `/live-view?cameraId=${encodeURIComponent(log.cameraId)}&logId=${encodeURIComponent(log.id)}&at=${encodeURIComponent(log.timestamp)}`,
    );
  };

  const handleVerifyLog = async (
    log: BullyingLog,
    verification: Exclude<IncidentVerification, "pending">,
  ) => {
    setVerifyingLogId(log.id);
    setActionMessage("");

    try {
      const updated = await updateBullyingLogVerification(log.id, verification);
      setLogs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setClipEventLog((current) => (
        current?.id === updated.id ? updated : current
      ));
      if (verification === "bullying") {
        router.push(`/laporan?logId=${encodeURIComponent(updated.id)}`);
      } else {
        setActionMessage("Indikasi ditandai bukan bullying, tetapi tetap disimpan sebagai log.");
      }
    } catch (error) {
      setActionMessage(
        `Validasi gagal: ${error instanceof Error ? error.message : "indikasi belum berhasil disimpan."}`,
      );
    } finally {
      setVerifyingLogId(null);
    }
  };
  const handleViewRecordings = async () => {
    if (!selectedCamera) return;

    setIsLoadingClip(true);
    setActionMessage("");
    try {
      const rangeEnd = new Date();
      const rangeStart = new Date(
        rangeEnd.getTime() - LIVE_PLAYBACK_WINDOW_SECONDS * 1000,
      );
      const segments = await getRecordingSegments({
        cameraId: selectedCamera.id,
        dateFrom: rangeStart.toISOString(),
        dateTo: rangeEnd.toISOString(),
      });
      const result = recordingSegmentsToLiveRecords(segments, selectedCamera);
      const sourceRecordings = result.length > 0 ? result : cameraRecordings;
      setCameraRecordings(result);
      const latestRecording = createLivePlaybackRecord(selectedCamera, sourceRecordings, playbackSpans);

      if (!latestRecording) {
        setActionMessage(
          "Rekaman belum tersedia. Tunggu sampai Raspberry Pi mengirim segment pertama.",
        );
        return;
      }

      setClipRecord(latestRecording);
      const start = new Date(latestRecording.startTime).getTime();
      const end = new Date(latestRecording.endTime).getTime();
      setClipEventLog(
        logs.find((log) => {
          const timestamp = new Date(log.timestamp).getTime();
          return log.cameraId === latestRecording.cameraId
            && timestamp >= start
            && timestamp <= end;
        }) ?? null,
      );
      setIsClipViewerOpen(true);
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? error.message
          : "Rekaman kamera belum dapat dimuat.",
      );
    } finally {
      setIsLoadingClip(false);
    }
  };


  const handleExportLiveClip = async (payload: VideoTrimExportPayload) => {
    if (!clipRecord) return;

    const startTime = new Date(clipRecord.startTime);
    startTime.setSeconds(startTime.getSeconds() + payload.trimStart);
    const endTime = new Date(clipRecord.startTime);
    endTime.setSeconds(endTime.getSeconds() + payload.trimEnd);

    const clip = await createEvidenceClip(clipRecord.id, {
      cameraId: clipRecord.cameraId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      reason: "live_view_trim_export",
    });

    setActionMessage("Klip " + clip.id + " sedang diproses...");
    const readyClip = await waitForEvidenceClip(clipRecord.id, clip.id);
    downloadEvidenceClip(readyClip);
    setActionMessage("Klip " + readyClip.id + " siap dan berhasil diunduh.");
  };

  return (    <>
      <div className="min-h-screen bg-slate-50 -m-4 p-4 pwa:-m-6 pwa:p-6">
        <DashboardPageHeader
          title="Live Camera"
          description="Pantau area sekolah secara langsung"
          desktopStatus={
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {connectedCameraCount}/{cameras.length} kamera terhubung
            </div>
          }
          onAlertClick={handleAlertClick}
        />

        <div className="mx-auto max-w-7xl space-y-5">
          {unreadCount > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 pwa:flex-row pwa:items-center pwa:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <ShieldAlert className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[13px] font-bold text-red-900">
                    Ada {unreadCount} notifikasi yang belum ditinjau
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-red-700">
                    Buka laporan untuk melihat waktu dan kamera terkait.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => router.push("/laporan")}
                className="rounded-lg bg-red-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-red-700"
              >
                Tinjau Notifikasi
              </button>
            </div>
          )}

          {loadError && (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 pwa:flex-row pwa:items-center pwa:justify-between">
              <div>
                <p className="text-[13px] font-bold text-amber-900">Kamera belum dapat dimuat</p>
                <p className="mt-0.5 text-[11px] font-medium text-amber-700">{loadError}</p>
              </div>
              <button
                type="button"
                onClick={() => void loadLiveData()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-[12px] font-bold text-amber-800 hover:bg-amber-100"
              >
                <RefreshCw className="h-4 w-4" />
                Muat Ulang
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <section className="xl:col-span-8 flex flex-col rounded-[20px] border border-slate-100 bg-white p-3 shadow-sm pwa:rounded-[24px] pwa:p-4 lg:p-5">
              <div className="mb-2 flex items-center justify-between gap-2 pwa:mb-3 lg:mb-4">
                <h2 className="min-w-0 truncate text-[16px] font-bold tracking-tight text-[#0f172a] pwa:text-[18px] lg:text-[22px]">
                  {selectedCamera?.name ?? "Belum ada kamera"}
                </h2>

                <div className="flex flex-shrink-0 items-center gap-1.5 rounded-full border border-slate-200/60 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600 shadow-sm pwa:gap-2 pwa:px-3 pwa:py-1.5 pwa:text-[11px] lg:text-[12px]">
                  <Calendar className="h-3 w-3 text-slate-400" />
                  <span>{formatDisplayDate(now)}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <Clock className="h-3 w-3 text-slate-400" />
                  <span className="font-mono font-bold text-slate-800">{formatClock(now)}</span>
                </div>
              </div>
              <div
                ref={videoContainerRef}
                className="group relative aspect-[16/9] w-full overflow-hidden rounded-[14px] bg-[#1e293b] pwa:rounded-[16px] lg:rounded-[20px]"
              >
                {selectedCamera && selectedCameraHasSource && selectedCameraGatewayReady ? (
                  <LiveCameraPlayer
                    key={selectedCamera.id}
                    camera={selectedCamera}
                    fallbackImage={getCameraImage(selectedCamera)}
                    isOnline
                    isPlaying={playerIsPlaying}
                    isMuted={isMuted}
                    useLocalWebcam={false}
                    timeshiftBehindSeconds={timeshiftBehindSeconds}
                    onLocalStatusChange={handlePlayerStatus}
                    onLiveBufferChange={handleLiveBufferChange}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 px-6 text-center text-slate-300">
                    {isLoading ||
                    selectedCameraAvailability === "checking" ||
                    activatingCameraId === selectedCamera?.id ? (
                      <Loader2 className="mb-4 h-9 w-9 animate-spin text-blue-400" />
                    ) : selectedCamera ? (
                      <Radio className="mb-4 h-10 w-10 text-slate-500" />
                    ) : (
                      <CameraOff className="mb-4 h-10 w-10 text-slate-500" />
                    )}
                    <p className="text-[14px] font-bold text-white">
                      {isLoading
                        ? "Memuat kamera..."
                        : !selectedCamera
                          ? "Belum ada kamera terdaftar"
                          : selectedCameraAvailability === "checking" ||
                              activatingCameraId === selectedCamera.id
                            ? "Memeriksa koneksi kamera..."
                            : "Menunggu Raspberry Pi"}
                    </p>
                    <p className="mt-1 max-w-sm text-[11px] font-medium leading-relaxed text-slate-400">
                      {selectedCamera
                        ? canManageCameras
                          ? "Pastikan Raspberry Pi sudah dipasang, lalu periksa koneksi kamera."
                          : "Kamera akan tampil otomatis setelah perangkat sekolah terhubung."
                        : canManageCameras
                          ? "Tambahkan kamera pertama untuk mulai memantau area sekolah."
                          : "Hubungi pengawas untuk mendaftarkan kamera sekolah."}
                    </p>
                    {selectedCamera && (
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleActivateCamera()}
                          disabled={
                            selectedCameraAvailability === "checking" ||
                            activatingCameraId === selectedCamera.id
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[12px] font-bold text-white transition-colors hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-300"
                        >
                          {activatingCameraId === selectedCamera.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                          {activatingCameraId === selectedCamera.id
                            ? "Memeriksa..."
                            : canManageCameras
                              ? "Aktifkan Kamera"
                              : "Periksa Koneksi"}
                        </button>
                        {LOCAL_WEBCAM_TEST_ENABLED && canManageCameras && selectedCamera.mediaPath && (
                          <button
                            type="button"
                            onClick={handleStartWebcamTest}
                            disabled={Boolean(webcamTestCameraId)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-400/40 bg-white/10 px-4 py-2.5 text-[12px] font-bold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Video className="h-4 w-4" />
                            Uji dengan Webcam
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="absolute left-2 top-2 z-20 pwa:left-3 pwa:top-3 lg:left-4 lg:top-4">
                  <div className="flex items-center gap-1.5 rounded-lg bg-[#1c1c1c]/80 px-2.5 py-1.5 text-white backdrop-blur-md pwa:gap-2 pwa:px-3">
                    <span className="text-[10px] font-bold pwa:text-[11px] lg:text-[12px]">{quality}</span>
                    <Signal className={cn("h-3 w-3 pwa:h-3.5 pwa:w-3.5 lg:h-4 lg:w-4", selectedCameraIsLive ? "text-emerald-500" : "text-slate-500")} />
                  </div>
                </div>

                {selectedOpenLog && (
                  <button
                    type="button"
                    onClick={() => handleOpenLog(selectedOpenLog)}
                    className="absolute right-3 top-3 z-20 flex max-w-[220px] items-center gap-2 rounded-lg border border-red-400/30 bg-red-600/90 px-3 py-2 text-left text-white shadow-lg backdrop-blur-md hover:bg-red-600"
                  >
                    <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-bold">Ada indikasi untuk ditinjau</span>
                      <span className="block truncate text-[9px] text-red-100">{formatClock(selectedOpenLog.timestamp)} WIB</span>
                    </span>
                  </button>
                )}

                <div className={cn("absolute bottom-3 left-3 right-3 z-20 flex items-center gap-3 rounded-[12px] bg-[#1a1a1a] px-3.5 py-2 text-white shadow-xl pwa:bottom-4 pwa:left-4 pwa:right-4 pwa:gap-5 pwa:rounded-[16px] pwa:px-4 pwa:py-2.5", !(selectedCamera && selectedCameraHasSource && selectedCameraGatewayReady) && "hidden")}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying((current) => {
                        const next = !current;
                        isPlayingRef.current = next;
                        return next;
                      });
                    }}
                    disabled={!playerCanInteract}
                    aria-label={playerIsPlaying ? "Jeda tayangan" : "Lanjutkan tayangan"}
                    title={playerIsPlaying ? "Jeda tayangan" : "Lanjutkan tayangan"}
                    className="text-white transition-colors hover:text-blue-400 disabled:text-white/35"
                  >
                    {playerIsPlaying ? <Pause className="h-4 w-4 fill-current pwa:h-5 pwa:w-5" /> : <Play className="h-4 w-4 fill-current pwa:h-5 pwa:w-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMuted((current) => !current)}
                    disabled={!playerCanInteract}
                    aria-label={isMuted ? "Aktifkan suara" : "Matikan suara"}
                    title={isMuted ? "Aktifkan suara" : "Matikan suara"}
                    className="text-white transition-colors hover:text-blue-400 disabled:text-white/35"
                  >
                    {isMuted ? <VolumeX className="h-4 w-4 pwa:h-5 pwa:w-5" /> : <Volume2 className="h-4 w-4 pwa:h-5 pwa:w-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuality((current) => current === "HD" ? "SD" : "HD")}
                    disabled={!playerCanInteract}
                    aria-label="Ubah kualitas tayangan"
                    title="Ubah kualitas tayangan"
                    className="rounded border border-white/30 px-1.5 py-0.5 text-[10px] font-bold text-white transition-colors hover:border-blue-400 hover:text-blue-400 disabled:text-white/35 pwa:text-[11px]"
                  >
                    {quality}
                  </button>

                  <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
                    {(isTimeshifted || isScrubbingTimeline) && (
                      <span className="hidden min-w-[40px] text-right font-mono text-[9px] font-bold tabular-nums text-blue-300 pwa:inline">
                        -{formatDvrOffset(dvrBehindLiveSeconds)}
                      </span>
                    )}
                    <div className="relative flex h-6 min-w-0 flex-1 items-center">
                      <div className="pointer-events-none relative h-1 w-full rounded-full bg-white/20 pwa:h-1.5">
                        <div
                          className={cn(
                            "absolute inset-y-0 left-0 rounded-full bg-blue-600 will-change-[width]",
                            selectedStatus.kind === "connecting" && "animate-pulse",
                          )}
                          style={{
                            width: dvrProgressPercent + "%",
                            transition: isScrubbingTimeline ? "none" : isTimeshifted ? "width 900ms linear" : "width 180ms ease-out",
                          }}
                        />
                        {playerCanInteract && (
                          <span
                            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md will-change-[left] pwa:h-3 pwa:w-3 pwa:bg-blue-600"
                            style={{
                              left: dvrProgressPercent + "%",
                              transition: isScrubbingTimeline ? "none" : isTimeshifted ? "left 900ms linear" : "left 180ms ease-out",
                            }}
                          />
                        )}
                        {timelineIncidentMarkers.map((marker) => (
                          <button
                            key={marker.id}
                            type="button"
                            data-live-incident-marker={marker.id}
                            disabled={!dvrCanSeek}
                            onClick={() => handleTimelineMarkerClick(marker)}
                            aria-label={`Buka kejadian ${marker.title} pada ${formatClock(marker.timestamp)} WIB`}
                            title={`${marker.title} - ${formatClock(marker.timestamp)} WIB`}
                            className={cn(
                              "pointer-events-auto absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1a1a1a] transition-transform hover:scale-125 disabled:cursor-default disabled:hover:scale-100 pwa:h-3.5 pwa:w-3.5",
                              marker.verificationStatus === "not-bullying"
                                ? "bg-slate-400 shadow-[0_0_0_1px_rgba(148,163,184,0.35)]"
                                : "bg-red-500 shadow-[0_0_0_1px_rgba(248,113,113,0.35)]",
                            )}
                            style={{ left: marker.percent + "%" }}
                          />
                        ))}
                      </div>
                      <input
                        data-live-timeline="true"
                        type="range"
                        min={0}
                        max={Math.max(1, timelineDurationSeconds)}
                        step={0.25}
                        value={Math.min(displayedDvrSliderPositionSeconds, Math.max(1, timelineDurationSeconds))}
                        onPointerDown={beginDvrSeek}
                        onChange={(event) => updateDvrSeek(Number(event.target.value))}
                        onPointerUp={() => commitDvrSeek()}
                        onPointerCancel={cancelDvrSeek}
                        onKeyUp={(event) => {
                          if (event.key !== "Tab") commitDvrSeek();
                        }}
                        onBlur={() => commitDvrSeek()}
                        disabled={!dvrCanSeek && !isScrubbingTimeline}
                        aria-label="Geser waktu tayangan"
                        aria-valuetext={(isTimeshifted || isScrubbingTimeline) ? formatDvrOffset(dvrBehindLiveSeconds) + " di belakang live" : dvrCanSeek ? "Live, buffer mundur tersedia" : "Menyiapkan buffer mundur"}
                        title={dvrCanSeek ? "Geser ke kiri untuk melihat beberapa menit sebelumnya" : "Buffer mundur sedang disiapkan"}
                        className="absolute inset-0 z-10 h-full w-full cursor-pointer touch-none opacity-0 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleReturnToLive}
                    disabled={!playerCanInteract}
                    aria-label={isTimeshifted || !isPlaying ? "Kembali ke tayangan live" : "Tayangan live"}
                    title={isTimeshifted || !isPlaying ? "Kembali ke tayangan live" : "Sedang live"}
                    className={cn(
                      "flex min-w-[52px] items-center justify-center gap-1.5 rounded-lg py-1 text-red-400 transition-colors hover:text-red-300 disabled:text-white/35 pwa:gap-2",
                      isTimeshifted && "border border-red-500/40 bg-red-500/10 px-2",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full bg-red-500 pwa:h-2 pwa:w-2", !isTimeshifted && isPlaying && "animate-pulse")} />
                    <span className="text-[11px] font-bold uppercase tracking-wider pwa:text-[12px]">LIVE</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleFullscreen()}
                    disabled={!selectedCamera}
                    aria-label={isFullscreen ? "Keluar layar penuh" : "Buka layar penuh"}
                    title={isFullscreen ? "Keluar layar penuh" : "Buka layar penuh"}
                    className="ml-1 text-white transition-colors hover:text-blue-400 disabled:text-white/35 pwa:ml-2"
                  >
                    {isFullscreen ? <Minimize className="h-4 w-4 pwa:h-5 pwa:w-5" /> : <Maximize className="h-4 w-4 pwa:h-5 pwa:w-5" />}
                  </button>
                </div>
              </div>

              <div className="mt-3 border-t border-slate-200 pt-3 pwa:mt-4 pwa:pt-4">
                <div className="hide-scrollbar -mx-1 flex gap-4 overflow-x-auto px-1 pb-1 pwa:grid pwa:grid-cols-4 pwa:gap-4 pwa:overflow-visible pwa:pb-0">
                  <div className="w-[136px] flex-none pwa:w-auto"><StatusFact label="Status" icon={<CheckCircle2 className="h-4 w-4" />} value={selectedStatus.label} tone={selectedStatus.kind === "live" ? "red" : selectedStatus.kind === "playback" ? "blue" : "slate"} /></div>
                  <div className="w-[136px] flex-none pwa:w-auto"><StatusFact label="Lokasi" icon={<MapPin className="h-4 w-4" />} value={selectedCamera?.location ?? "-"} /></div>
                  <div className="w-[136px] flex-none pwa:w-auto"><StatusFact
                    label="Sinyal terakhir"
                    icon={<Clock className="h-4 w-4" />}
                    value={selectedCameraIsLive ? "Baru saja" : selectedCamera && getEffectiveCameraAvailability(selectedCamera.id) === "live" ? `${formatDisplayDate(selectedCamera.lastActive)}, ${formatClock(selectedCamera.lastActive)}` : selectedCamera ? "Belum ada sinyal" : "-"}
                  /></div>
                  <div className="w-[136px] flex-none pwa:w-auto"><StatusFact
                    label="Pemantauan"
                    icon={<ShieldCheck className="h-4 w-4" />}
                    value={selectedCamera?.isAiEnabled ? "Aktif" : "Tidak aktif"}
                    tone={selectedCamera?.isAiEnabled ? "green" : "slate"}
                  /></div>
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 pwa:flex-row pwa:items-center pwa:justify-between">
                  <div className="min-h-5 text-[13px] font-medium text-slate-500">
                    {actionMessage || (webcamTestCameraId ? webcamTestStatus?.message : "") || (selectedCameraHasSource ? playerStatus.message : "Kamera siap dipantau setelah perangkat terhubung.")}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {LOCAL_WEBCAM_TEST_ENABLED && webcamTestCameraId && (
                      <button
                        type="button"
                        onClick={handleStopWebcamTest}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-[13px] font-bold text-red-600 transition-colors hover:bg-red-100 pwa:flex-none"
                      >
                        {webcamTestStatus?.state === "active" ? (
                          <Power className="h-4 w-4" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        {webcamTestStatus?.state === "active" ? "Hentikan Uji" : "Batalkan Uji"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleViewRecordings()}
                      disabled={!selectedCamera || isLoadingClip}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-[13px] font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 pwa:flex-none transition-colors"
                    >
                      {isLoadingClip ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {isLoadingClip ? "Memuat Rekaman..." : "Lihat Cuplikan"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
            <aside className="flex flex-col overflow-hidden rounded-[20px] border border-slate-100 bg-white p-3 shadow-sm pwa:rounded-[24px] pwa:p-4 lg:p-5 xl:col-span-4">
              <div className="mb-3 flex items-center justify-between gap-2 pwa:mb-4">
                <h2 className="text-[14px] font-bold text-[#1e293b] pwa:text-[15px] lg:text-[16px]">Daftar Kamera</h2>
                <span className="text-[10px] font-medium text-slate-400 pwa:text-[11px]">
                  {cameras.length > 0 ? `${cameras.length} kamera` : "Belum ada kamera"}
                </span>
              </div>

              <div className="hide-scrollbar -mr-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-3 pr-3 md:mr-0 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 md:pr-0 md:snap-none xl:flex xl:flex-col xl:gap-3 xl:overflow-visible xl:pb-0 xl:pr-0">
                {isLoading && cameras.length === 0 && (
                  <>
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="h-[76px] w-[150px] flex-shrink-0 animate-pulse rounded-xl bg-slate-100 pwa:w-[160px] md:w-full xl:w-full" />
                    ))}
                  </>
                )}

                {!isLoading && cameras.length === 0 && canManageCameras && (
                  <button
                    type="button"
                    onClick={handleOpenAddCamera}
                    className="group flex min-h-[150px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center transition-all hover:border-blue-300 hover:bg-blue-50/50"
                  >
                    <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-slate-100 bg-white shadow-sm transition-transform group-hover:scale-110">
                      <Plus className="h-5 w-5 text-blue-500" />
                    </span>
                    <span className="text-[13px] font-bold text-slate-700 group-hover:text-blue-700">Tambah Kamera Baru</span>
                    <span className="mt-1 max-w-[200px] text-[11px] text-slate-500">Hubungkan kamera pertama untuk mulai memantau.</span>
                  </button>
                )}

                {!isLoading && cameras.length === 0 && !canManageCameras && (
                  <div className="flex min-h-[150px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                    <CameraOff className="mb-3 h-8 w-8 text-slate-400" />
                    <p className="text-[12px] font-bold text-slate-700">Belum ada kamera terdaftar</p>
                    <p className="mt-1 text-[11px] text-slate-500">Kamera akan muncul setelah didaftarkan oleh pengawas.</p>
                  </div>
                )}

                {cameras.map((camera) => {
                  const isSelected = camera.id === selectedCamera?.id;
                  const cameraAvailability = isSelected && selectedCameraIsLive
                    ? "live"
                    : getEffectiveCameraAvailability(camera.id);
                  const openLog = unresolvedLogByCameraId.get(camera.id);
                  const availabilityView = getAvailabilityView(cameraAvailability);

                  return (
                    <div
                      key={camera.id}
                      className={cn(
                        "group relative w-[150px] flex-shrink-0 snap-start rounded-xl border transition-all pwa:w-[160px] md:w-full xl:w-full",
                        isSelected
                          ? "border-blue-200 bg-blue-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedCameraId(camera.id)}
                        className="flex min-h-[76px] w-full items-center justify-between gap-2 rounded-xl p-3 pr-10 text-left outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                      >
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-[12px] font-bold pwa:text-[13px]", isSelected ? "text-blue-700" : "text-slate-800")}>{camera.name}</span>
                          <span className="mb-1.5 block truncate text-[11px] text-slate-500">{camera.location}</span>
                          <span className={cn("flex flex-wrap items-center gap-1.5 text-[10px] font-medium", availabilityView.textClass)}>
                            <span className={cn("h-2.5 w-2.5 rounded-full", availabilityView.dotClass)} />
                            {availabilityView.label}
                            {openLog && (
                              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">Perlu ditinjau</span>
                            )}
                          </span>
                        </span>

                        {isSelected ? (
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-blue-600 pwa:h-5 pwa:w-5" />
                        ) : (
                          <Play className="h-4 w-4 flex-shrink-0 text-slate-400 opacity-50 transition-opacity group-hover:opacity-100" />
                        )}
                      </button>

                      {canManageCameras && (
                        <div className="absolute right-1 top-2 flex-shrink-0 pwa:right-1.5">
                          <Popover>
                            <PopoverTrigger className="rounded-md p-1.5 text-slate-400 outline-none transition-colors hover:bg-slate-100 hover:text-slate-600" aria-label={`Opsi ${camera.name}`} title={`Opsi ${camera.name}`}>
                              <MoreVertical className="h-4 w-4" />
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-md">
                              <button
                                type="button"
                                onClick={() => handleOpenRaspberryPiCommand(camera)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-bold text-slate-700 transition-colors hover:bg-slate-50"
                              >
                                <Terminal className="h-4 w-4" />
                                Command Raspberry Pi
                              </button>                              <button
                                type="button"
                                onClick={() => openRenameCamera(camera)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-bold text-slate-700 transition-colors hover:bg-slate-50"
                              >
                                <Pencil className="h-4 w-4" />
                                Ubah Nama & Lokasi
                              </button>
                              <button
                                type="button"
                                onClick={() => setCameraToDelete(camera)}
                                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-bold text-red-600 transition-colors hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                Hapus Kamera
                              </button>
                            </PopoverContent>
                          </Popover>
                        </div>
                      )}
                    </div>
                  );
                })}

                {cameras.length > 0 && canManageCameras && (
                  <button
                    type="button"
                    onClick={handleOpenAddCamera}
                    className="flex min-h-[76px] w-[150px] flex-shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-3 transition-all hover:border-slate-300 hover:bg-slate-100 pwa:w-[160px] md:w-full md:flex-row xl:w-full xl:flex-row"
                  >
                    <Plus className="h-5 w-5 text-slate-400" />
                    <span className="text-[12px] font-bold text-slate-500">Tambah Kamera</span>
                  </button>
                )}
              </div>
            </aside>
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm pwa:rounded-[24px]">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 pwa:p-5">
              <div>
                <h2 className="text-[16px] font-bold text-[#1e293b] pwa:text-[18px]">Indikasi Terbaru</h2>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500 pwa:text-[12px]">
                  {selectedCamera ? `Aktivitas dari ${selectedCamera.name}` : "Aktivitas kamera sekolah"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push("/laporan")}
                className="flex h-9 items-center rounded-lg px-2 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 pwa:px-3 pwa:text-[12px]"
              >
                Lihat Semua
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {visibleLogs.length === 0 && (
                <div className="flex min-h-40 flex-col items-center justify-center px-4 py-10 text-center">
                  <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50">
                    <ShieldCheck className="h-6 w-6 text-emerald-500" />
                  </span>
                  <p className="text-[14px] font-bold text-[#1e293b] pwa:text-[15px]">Belum ada indikasi pada kamera ini</p>
                  <p className="mt-1 max-w-sm text-[11px] font-medium leading-relaxed text-slate-500 pwa:text-[12px]">Notifikasi baru akan muncul di sini saat aplikasi menerima kejadian.</p>
                </div>
              )}

              {visibleLogs.map((log) => {
                const severity = getSeverityView(log.severity);
                const isPending = isVerificationPending(log.verificationStatus);
                const isVerifying = verifyingLogId === log.id;

                return (
                  <div key={log.id} className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50 pwa:flex-row pwa:items-center pwa:gap-4 pwa:p-5">
                    <button
                      type="button"
                      onClick={() => handleOpenLog(log)}
                      className="flex min-w-0 w-full flex-1 items-start gap-3 text-left outline-none focus-visible:rounded-xl focus-visible:ring-4 focus-visible:ring-blue-100 pwa:items-center pwa:gap-4"
                    >
                      <span className={cn("flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[8px] pwa:h-12 pwa:w-12 pwa:rounded-xl", severity.iconBackground, severity.iconColor)}>
                        <ShieldAlert className="h-5 w-5" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-[#1e293b] pwa:text-[15px]">{log.title}</span>
                        <span className="mt-0.5 block text-[11px] font-medium leading-relaxed text-slate-500 pwa:text-[12px]">{log.description}</span>
                        <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] font-medium text-slate-500 pwa:text-[12px]">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                            {formatClock(log.timestamp)} WIB
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
                            {formatDisplayDate(log.timestamp)}
                          </span>
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <Video className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="truncate">{log.cameraName}</span>
                          </span>
                        </span>
                      </span>
                    </button>

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 pwa:flex-shrink-0 pwa:justify-end pwa:border-0 pwa:pt-0">
                      {isPending ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleVerifyLog(log, "bullying")}
                            disabled={isVerifying}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-500 bg-red-500 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-wait disabled:opacity-60 pwa:flex-none pwa:text-[12px]"
                          >
                            {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                            Bullying
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleVerifyLog(log, "not-bullying")}
                            disabled={isVerifying}
                            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 pwa:flex-none pwa:text-[12px]"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Bukan Bullying
                          </button>
                        </>
                      ) : (
                        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold pwa:text-[11px]", getVerificationStyle(log.verificationStatus))}>
                          {getVerificationLabel(log.verificationStatus)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {isAddCameraOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAddCamera();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-camera-title"
            className={cn(
              "max-h-[90vh] w-full overflow-y-auto rounded-[22px] border border-slate-200 bg-white shadow-2xl",
              createdCamera ? "max-w-2xl" : "max-w-md"
            )}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 pwa:px-6">
              <div className="min-w-0">
                <h2 id="add-camera-title" className="text-[18px] font-bold text-slate-950 pwa:text-[20px]">
                  {createdCamera ? "Command Raspberry Pi" : "Tambah Kamera"}
                </h2>
                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500 pwa:text-[12px]">
                  {createdCamera
                    ? "Jalankan command ini di terminal Raspberry Pi Anda."
                    : "Isi nama dan lokasi kamera untuk menyiapkan channel pemantauan."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAddCamera}
                aria-label="Tutup"
                title="Tutup"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {createdCamera ? (
              <>
                <div className="space-y-5 bg-slate-50/70 px-5 py-5 pwa:px-6">
                  <div className="overflow-hidden rounded-[16px] border border-slate-700 bg-[#0f1b31] shadow-inner">
                    <div className="flex items-center justify-between border-b border-slate-700 bg-[#1b2b45] px-4 py-3 text-slate-300">
                      <span className="font-mono text-[11px] font-medium">bash</span>
                      <button
                        type="button"
                        onClick={() => void handleCopyRaspberryPiCommand()}
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold text-slate-200 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        {commandCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {commandCopied ? "Tersalin" : "Copy"}
                      </button>
                    </div>
                    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all px-4 py-5 font-mono text-[11px] leading-6 text-emerald-400 pwa:text-[12px]">
                      <code>{raspberryPiCommand}</code>
                    </pre>
                  </div>

                  <div className="flex items-start gap-3 rounded-[16px] border border-blue-200 bg-blue-50 px-4 py-4 text-blue-800">
                    <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
                    <p className="text-[11px] font-medium leading-relaxed pwa:text-[12px]">
                      Setelah command dijalankan dan Raspberry Pi berhasil terhubung, stream video
                      otomatis masuk ke kamera <span className="font-bold">{createdCamera.mediaPath ?? createdCamera.id}</span>.
                    </p>
                  </div>

                  {cameraFormError && (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                      {cameraFormError}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4 pwa:px-6">
                  <button
                    type="button"
                    onClick={closeAddCamera}
                    className="rounded-lg px-4 py-2.5 text-[12px] font-bold text-slate-600 hover:bg-slate-100"
                  >
                    Tutup
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommandAndClose()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[12px] font-bold text-white shadow-sm hover:bg-blue-700"
                  >
                    <Copy className="h-4 w-4" />
                    Copy & Tutup
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleAddCamera} className="space-y-4 px-5 py-5 pwa:px-6">
                <div>
                  <label htmlFor="camera-name" className="text-[11px] font-bold text-slate-700">Nama Kamera</label>
                  <input
                    id="camera-name"
                    value={cameraForm.name}
                    onChange={(event) => setCameraForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Contoh: Koridor Lantai 2"
                    autoFocus
                    className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label htmlFor="camera-location" className="text-[11px] font-bold text-slate-700">Lokasi</label>
                  <input
                    id="camera-location"
                    value={cameraForm.location}
                    onChange={(event) => setCameraForm((current) => ({ ...current, location: event.target.value }))}
                    placeholder="Contoh: Gedung A, lantai 2"
                    className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>

                {cameraFormError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                    {cameraFormError}
                  </p>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeAddCamera}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingCamera}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-[12px] font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {isSubmittingCamera && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isSubmittingCamera ? "Menyiapkan..." : "Lanjutkan"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {cameraToRename && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRenameCamera();
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-camera-title"
            onSubmit={handleRenameCamera}
            className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="rename-camera-title" className="text-[17px] font-bold text-slate-950">Ubah Kamera</h2>
                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-500">
                  Nama dan lokasi baru akan digunakan di daftar dan tampilan kamera.
                </p>
              </div>
              <button
                type="button"
                onClick={closeRenameCamera}
                disabled={isRenamingCamera}
                aria-label="Tutup"
                title="Tutup"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5">
              <label htmlFor="camera-rename" className="text-[11px] font-bold text-slate-700">Nama Kamera</label>
              <input
                id="camera-rename"
                value={cameraNameDraft}
                onChange={(event) => setCameraNameDraft(event.target.value)}
                maxLength={120}
                autoFocus
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div className="mt-4">
              <label htmlFor="camera-rename-location" className="text-[11px] font-bold text-slate-700">Lokasi Kamera</label>
              <input
                id="camera-rename-location"
                value={cameraLocationDraft}
                onChange={(event) => setCameraLocationDraft(event.target.value)}
                maxLength={180}
                placeholder="Contoh: Gedung A, lantai 2"
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </div>

            {cameraRenameError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
                {cameraRenameError}
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeRenameCamera}
                disabled={isRenamingCamera}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isRenamingCamera}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-[12px] font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {isRenamingCamera && <Loader2 className="h-4 w-4 animate-spin" />}
                {isRenamingCamera ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </form>
        </div>
      )}

      {cameraToDelete && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-camera-title" className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600">
              <Trash2 className="h-5 w-5" />
            </span>
            <h2 id="delete-camera-title" className="mt-4 text-[17px] font-bold text-slate-950">Hapus {cameraToDelete.name}?</h2>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate-500">Kamera akan dihapus dari daftar pemantauan. Rekaman yang sudah tersimpan tidak ikut dihapus.</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setCameraToDelete(null)} disabled={isDeletingCamera} className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-[12px] font-bold text-slate-700 hover:bg-slate-50">Batal</button>
              <button type="button" onClick={() => void handleDeleteCamera()} disabled={isDeletingCamera} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-[12px] font-bold text-white hover:bg-red-700 disabled:bg-slate-300">
                {isDeletingCamera && <Loader2 className="h-4 w-4 animate-spin" />}
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {clipRecord && (
        <VideoTrimmerModal
          isOpen={isClipViewerOpen}
          onClose={() => {
            setIsClipViewerOpen(false);
            setClipEventLog(null);
          }}
          onExport={handleExportLiveClip}
          recordData={{
            cameraName: clipRecord.cameraName,
            date: formatDisplayDate(clipRecord.startTime),
            time: formatClock(clipRecord.startTime),
            playbackUrl: clipRecord.playbackUrl,
            duration: clipRecord.duration,
            startTime: clipRecord.startTime,
          }}
          eventTime={clipEventLog?.timestamp ?? clipRecord.startTime}
          timelineMarkerLabel={clipEventLog ? "Indikasi Bullying" : "Awal Rekaman"}
          liveContext
          canExport={canManageCameras}
          reviewActions={clipEventLog ? (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold text-white">
                  Validasi indikasi ini
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Tonton rekaman pada titik merah, lalu tentukan hasilnya.
                </p>
              </div>
              {isVerificationPending(clipEventLog.verificationStatus) ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleVerifyLog(clipEventLog, "bullying")}
                    disabled={verifyingLogId === clipEventLog.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    {verifyingLogId === clipEventLog.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <ShieldAlert className="h-3.5 w-3.5" />}
                    Bullying
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleVerifyLog(clipEventLog, "not-bullying")}
                    disabled={verifyingLogId === clipEventLog.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-wait disabled:opacity-60"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Tidak Bullying
                  </button>
                </div>
              ) : (
                <span className={cn(
                  "w-fit rounded-full border px-3 py-1.5 text-[11px] font-bold",
                  getVerificationStyle(clipEventLog.verificationStatus),
                )}>
                  {getVerificationLabel(clipEventLog.verificationStatus)}
                </span>
              )}
            </div>
          ) : undefined}
        />
      )}
    </>
  );
}
function createLivePlaybackRecord(
  camera: CameraType,
  recordings: Recording[],
  playbackSpans: GatewayPlaybackSpan[] = [],
  focusTimestamp?: string,
): Recording | null {
  const available = recordings
    .filter(
      (recording) =>
        recording.cameraId === camera.id
        && recording.storageStatus === "available"
        && recording.playbackUrl,
    )
    .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime());
  if (available.length === 0) return null;

  const latest = available[available.length - 1];
  const focusTimeValue = focusTimestamp ? new Date(focusTimestamp).getTime() : Number.NaN;
  const focusTime = Number.isFinite(focusTimeValue) ? focusTimeValue : null;
  const focusWindowHalfMs = (LIVE_PLAYBACK_WINDOW_SECONDS * 1000) / 2;
  const recordingAtFocus = focusTime === null
    ? null
    : available.find((recording) => {
        const startTime = new Date(recording.startTime).getTime();
        const endTime = new Date(recording.endTime).getTime();
        return startTime <= focusTime && focusTime <= endTime;
      }) ?? null;
  const recordTemplate = recordingAtFocus ?? latest;
  const normalizedSpans = playbackSpans
    .map((span) => {
      const startTime = new Date(span.start).getTime();
      return {
        startTime,
        endTime: startTime + span.duration * 1000,
      };
    })
    .filter(
      (span) =>
        Number.isFinite(span.startTime)
        && Number.isFinite(span.endTime)
        && span.endTime > span.startTime,
    )
    .sort((left, right) => left.endTime - right.endTime);
  const focusedSpan = focusTime === null
    ? null
    : normalizedSpans.find(
        (span) => span.startTime - 5_000 <= focusTime && focusTime <= span.endTime + 5_000,
      ) ?? null;
  const playbackSpan = focusedSpan ?? normalizedSpans.at(-1);

  if (camera.mediaPath && playbackSpan) {
    const recordedEndTime = Math.min(
      playbackSpan.endTime,
      Date.now(),
      focusTime === null
        ? Number.POSITIVE_INFINITY
        : focusTime + focusWindowHalfMs,
    );
    const playbackStartTime = Math.max(
      playbackSpan.startTime + DVR_PLAYBACK_START_GUARD_MS,
      focusTime === null
        ? recordedEndTime - LIVE_PLAYBACK_WINDOW_SECONDS * 1000
        : focusTime - focusWindowHalfMs,
    );
    if (recordedEndTime > playbackStartTime) {
      const duration = Math.max(1, Math.round((recordedEndTime - playbackStartTime) / 1000));
      const startTime = new Date(playbackStartTime).toISOString();
      return {
        ...recordTemplate,
        startTime,
        endTime: new Date(recordedEndTime).toISOString(),
        duration,
        playbackUrl: buildGatewayPlaybackUrl(camera.mediaPath, startTime, duration),
      };
    }
  }

  const templateStart = new Date(recordTemplate.startTime);
  const latestEnd = new Date(latest.endTime);
  if (Number.isNaN(templateStart.getTime()) || Number.isNaN(latestEnd.getTime())) {
    return recordTemplate;
  }

  const recordedEndTime = Math.min(
    latestEnd.getTime(),
    Date.now(),
    focusTime === null
      ? Number.POSITIVE_INFINITY
      : focusTime + focusWindowHalfMs,
  );
  if (recordedEndTime <= templateStart.getTime()) return recordTemplate;

  const windowStartLimit = focusTime === null
    ? recordedEndTime - LIVE_PLAYBACK_WINDOW_SECONDS * 1000
    : focusTime - focusWindowHalfMs;
  const firstInWindow = available.find((recording) => {
    const startTime = new Date(recording.startTime).getTime();
    const endTime = new Date(recording.endTime).getTime();
    return endTime > windowStartLimit && startTime < recordedEndTime;
  }) ?? recordTemplate;
  const firstStart = new Date(firstInWindow.startTime);
  const playbackStart = new Date(
    Math.max(windowStartLimit, firstStart.getTime() + DVR_PLAYBACK_START_GUARD_MS),
  );
  const duration = Math.max(1, Math.round((recordedEndTime - playbackStart.getTime()) / 1000));
  const playbackUrl = camera.mediaPath
    ? buildGatewayPlaybackUrl(camera.mediaPath, playbackStart.toISOString(), duration)
    : recordTemplate.playbackUrl;

  return {
    ...recordTemplate,
    startTime: playbackStart.toISOString(),
    endTime: new Date(recordedEndTime).toISOString(),
    duration,
    playbackUrl,
  };
}

function recordingSegmentsToLiveRecords(
  segments: RecordingSegment[],
  camera: Pick<CameraType, "id" | "name" | "location">,
): Recording[] {
  return segments.map((segment) => ({
    id: segment.id,
    cameraId: camera.id,
    cameraName: camera.name,
    location: camera.location,
    startTime: segment.startTime,
    endTime: segment.endTime,
    duration: segment.duration,
    fileUrl: segment.mediaUrl,
    fileSize: segment.fileSize,
    hasIncident: false,
    incidentCount: 0,
    thumbnailUrl: null,
    status: "tersimpan",
    storageStatus: segment.mediaUrl ? "available" : "unavailable",
    playbackUrl: segment.mediaUrl,
  }));
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatDvrOffset(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function StatusFact({
  label,
  icon,
  value,
  tone = "slate",
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  tone?: "slate" | "green" | "red" | "blue";
}) {
  const toneClass = {
    slate: "text-slate-500",
    green: "text-emerald-600",
    red: "text-red-500",
    blue: "text-blue-600",
  }[tone];

  return (
    <div className="min-w-0">
      <p className="text-[12px] font-semibold text-slate-500">{label}</p>
      <div className={cn("mt-1.5 flex items-start gap-2", toneClass)}>
        <span className="mt-[3px] flex-shrink-0">{icon}</span>
        <span className="min-w-0 break-words text-[13px] font-bold leading-snug text-slate-800">{value}</span>
      </div>
    </div>
  );
}

type SelectedStatusKind = "none" | "waiting" | "connecting" | "live" | "playback" | "paused" | "offline";

function getSelectedStatus({
  hasCamera,
  hasSource,
  playerStatus,
  isPlaying,
  isTimeshifted,
}: {
  hasCamera: boolean;
  hasSource: boolean;
  playerStatus: LiveCameraPlayerStatus;
  isPlaying: boolean;
  isTimeshifted: boolean;
}): { kind: SelectedStatusKind; label: string } {
  if (!hasCamera) return { kind: "none", label: "Belum tersedia" };
  if (!hasSource) return { kind: "waiting", label: "Menunggu perangkat" };
  if (isTimeshifted) return { kind: "playback", label: "Memutar ulang" };
  if (playerStatus.state === "active") {
    return isPlaying
      ? { kind: "live", label: "Live" }
      : { kind: "paused", label: "Dijeda" };
  }
  if (["idle", "starting"].includes(playerStatus.state)) {
    return { kind: "connecting", label: "Menghubungkan" };
  }
  return { kind: "offline", label: "Tidak terhubung" };
}


function getAvailabilityView(status: CameraAvailability) {
  if (status === "live") {
    return { label: "Live", textClass: "text-emerald-600", dotClass: "bg-emerald-500" };
  }
  if (status === "checking") {
    return { label: "Memeriksa", textClass: "text-blue-600", dotClass: "animate-pulse bg-blue-500" };
  }
  if (status === "waiting") {
    return { label: "Menunggu perangkat", textClass: "text-slate-500", dotClass: "bg-slate-400" };
  }
  return { label: "Tidak terhubung", textClass: "text-red-600", dotClass: "bg-red-500" };
}

function withPlayableSource(camera: CameraType): CameraType {
  const gatewayUrl = camera.mediaPath ? buildGatewayHlsUrl(camera.mediaPath) : "";
  const streamUrl = gatewayUrl || camera.liveHlsUrl || camera.streamUrl;
  if (!streamUrl) return camera;

  return {
    ...camera,
    sourceType: camera.mediaPath ? "hls" : camera.sourceType,
    streamUrl,
    liveHlsUrl: camera.mediaPath ? streamUrl : camera.liveHlsUrl,
  };
}

async function checkCameraAvailability(camera: CameraType): Promise<CameraAvailability> {
  try {
    const connection = await getCameraConnectionStatus(camera.id);
    if (connection.connected) return "live";
    return connection.status === "waiting" ? "waiting" : "offline";
  } catch {
    return "offline";
  }
}

function getSeverityView(severity: BullyingLog["severity"]) {
  if (severity === "critical" || severity === "high") {
    return { iconBackground: "bg-red-50", iconColor: "text-red-600" };
  }
  if (severity === "medium") {
    return { iconBackground: "bg-amber-50", iconColor: "text-amber-600" };
  }
  return { iconBackground: "bg-blue-50", iconColor: "text-blue-600" };
}

function isVerificationPending(status: IncidentVerification | undefined) {
  return status !== "bullying" && status !== "not-bullying";
}

function getVerificationLabel(status: IncidentVerification | undefined) {
  if (status === "bullying") return "Bullying terkonfirmasi";
  if (status === "not-bullying") return "Bukan bullying";
  return "Perlu validasi";
}

function getVerificationStyle(status: IncidentVerification | undefined) {
  if (status === "bullying") return "border-red-200 bg-red-50 text-red-700";
  if (status === "not-bullying") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}
