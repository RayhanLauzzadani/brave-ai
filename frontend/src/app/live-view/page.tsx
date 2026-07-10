"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, Calendar, Signal, Volume2, Pause, VolumeX, Save, Smartphone, RefreshCw,
  ShieldCheck, CheckCircle2, Camera, Play, MoreVertical, Menu, MapPin, Clock, ShieldAlert, Circle, Maximize, Minimize,
  ChevronDown, Check, Plus, X, Loader2, Trash2, ChevronLeft, ChevronRight, Square, Download, MonitorUp, Copy, Info
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { MobileSidebar } from "@/components/layout/mobile-nav";
import { LiveCameraPlayer, type LiveCameraPlayerStatus, type LocalVideoDevice } from "@/components/camera/live-camera-player";
import { useRouter } from "next/navigation";
import { getAlerts, subscribeAlerts } from "@/lib/api/alerts";
import { getBullyingLogs } from "@/lib/api/bullying-logs";
import { getCameras, updateCameraSource, createCamera, deleteCamera } from "@/lib/api/cameras";
import { createEvidenceClip, getRecordingById, getRecordings } from "@/lib/api/recordings";
import { useAlertStore } from "@/lib/stores/alert-store";
import { useCameraStore } from "@/lib/stores/camera-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";
import {
  buildGatewayHlsUrl,
  buildGatewayWebRtcPublisherUrl,
  buildRaspberryPiInstallCommand,
  extractMediaPathFromHlsUrl,
  getDevicePublisherMediaPath,
  normalizeMediaPath,
} from "@/lib/media-gateway";
import type { BullyingLog, Camera as CameraType, CameraSourceType, Recording } from "@/lib/types";
import {
  FALLBACK_ACTIVITIES,
  FALLBACK_CAMERAS,
  LIVE_VIEW_INITIAL_TIME_ISO,
  cameraStatusLabel,
  formatClock,
  formatDisplayDate,
  formatMobileDate,
  getCameraImage,
  isCameraOnline,
  toActivityItems,
  toQuickRecordingItems,
} from "./live-view-presenters";

type LocalRecordingState = "idle" | "recording" | "ready" | "error";

type LocalRecordingResult = {
  url: string;
  fileName: string;
  fileSize: number;
  startTime: string;
  endTime: string;
  duration: number;
  mimeType: string;
  backendClipId?: string;
};

export default function LiveViewPage() {
  const router = useRouter();
  const unreadCount = useAlertStore((s) => s.unreadCount);
  const setAlerts = useAlertStore((s) => s.setAlerts);
  const addAlert = useAlertStore((s) => s.addAlert);
  const selectedCameraId = useCameraStore((s) => s.selectedCameraId);
  const setSelectedCameraId = useCameraStore((s) => s.setSelectedCamera);
  const isCollapsed = useUiStore((s) => s.isSidebarCollapsed);

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const localRecordingTimerRef = useRef<number | null>(null);
  const localRecordingObjectUrlRef = useRef<string | null>(null);
  const previousSelectedCameraIdRef = useRef<string | null>(null);
  const publisherWindowsRef = useRef<Map<string, Window>>(new Map());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [quality, setQuality] = useState<"HD" | "SD">("HD");
  const [now, setNow] = useState(() => new Date(LIVE_VIEW_INITIAL_TIME_ISO));
  const [cameras, setCameras] = useState<CameraType[]>(FALLBACK_CAMERAS);
  const [logs, setLogs] = useState<BullyingLog[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [localRecordingState, setLocalRecordingState] = useState<LocalRecordingState>("idle");
  const [localRecordingStartedAt, setLocalRecordingStartedAt] = useState<string | null>(null);
  const [localRecordingElapsed, setLocalRecordingElapsed] = useState(0);
  const [localRecordingResult, setLocalRecordingResult] = useState<LocalRecordingResult | null>(null);
  const [localRecordingMessage, setLocalRecordingMessage] = useState("");

  const [localWebcamCameraId, setLocalWebcamCameraId] = useState<string | null>(null);
  const [pausedLocalWebcamByCameraId, setPausedLocalWebcamByCameraId] = useState<Record<string, boolean>>({});
  const [sourceType, setSourceType] = useState<CameraSourceType>("mock");
  const [streamUrlInput, setStreamUrlInput] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [sourceStatusState, setSourceStatusState] = useState<LiveCameraPlayerStatus["state"]>("idle");
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [isOpeningPublisher, setIsOpeningPublisher] = useState(false);
  const [isCopyingPiCommand, setIsCopyingPiCommand] = useState(false);
  const [isTestingSource, setIsTestingSource] = useState(false);
  const [videoDevices, setVideoDevices] = useState<LocalVideoDevice[]>([]);
  const [localDeviceByCameraId, setLocalDeviceByCameraId] = useState<Record<string, string>>({});
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [isSourceTypeOpen, setIsSourceTypeOpen] = useState(false);
  const [isVideoDeviceOpen, setIsVideoDeviceOpen] = useState(false);
  const [sourceTab, setSourceTab] = useState<"stream" | "webcam" | "advanced">("stream");

  const [isAddCameraModalOpen, setIsAddCameraModalOpen] = useState(false);
  const [piCommandModal, setPiCommandModal] = useState<{ command: string; mediaPath: string } | null>(null);
  const [newCameraName, setNewCameraName] = useState("");
  const [newCameraLocation, setNewCameraLocation] = useState("");
  const [cameraToDelete, setCameraToDelete] = useState<string | null>(null);
  const [isSubmittingCamera, setIsSubmittingCamera] = useState(false);

  const loadLiveData = useCallback(async () => {
    const [cameraResult, logResult, recordingResult, alertResult] =
      await Promise.allSettled([
        getCameras(),
        getBullyingLogs(),
        getRecordings({ hasIncident: true }),
        getAlerts(),
      ]);

    if (cameraResult.status === "fulfilled") {
      const nextCameras = cameraResult.value;
      setCameras(nextCameras);
      if (nextCameras.length > 0) {
        setSelectedCameraId(
          selectedCameraId && nextCameras.some((camera) => camera.id === selectedCameraId)
            ? selectedCameraId
            : nextCameras[0]?.id ?? null
        );
      } else {
        setSelectedCameraId(null);
      }
    }

    if (logResult.status === "fulfilled") {
      setLogs(logResult.value);
    }

    if (recordingResult.status === "fulfilled") {
      setRecordings(recordingResult.value);
    }

    if (alertResult.status === "fulfilled") {
      setAlerts(alertResult.value);
    }
  }, [selectedCameraId, setAlerts, setSelectedCameraId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadLiveData();
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [loadLiveData]);

  const handleAddCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCameraName || !newCameraLocation) return;
    setIsSubmittingCamera(true);
    try {
      await createCamera({ name: newCameraName, location: newCameraLocation, isAiEnabled: true, sourceType: "mock" });
      setNewCameraName("");
      setNewCameraLocation("");
      setIsAddCameraModalOpen(false);
      await loadLiveData();
    } catch (error) {
      console.error("Failed to add camera:", error);
    } finally {
      setIsSubmittingCamera(false);
    }
  };

  const handleDeleteCamera = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setCameraToDelete(id);
  };

  const confirmDeleteCamera = async () => {
    if (!cameraToDelete) return;
    try {
      await deleteCamera(cameraToDelete);
      await loadLiveData();
      if (selectedCameraId === cameraToDelete) {
        setSelectedCameraId(cameras.find(c => c.id !== cameraToDelete)?.id || null);
      }
    } catch (error) {
      console.error("Failed to delete camera:", error);
    } finally {
      setCameraToDelete(null);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeAlerts((alert) => {
      addAlert(alert);
      void loadLiveData();
    });

    return unsubscribe;
  }, [addAlert, loadLiveData]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setNow(new Date()), 0);
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (localRecordingTimerRef.current !== null) {
        window.clearInterval(localRecordingTimerRef.current);
        localRecordingTimerRef.current = null;
      }

      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state !== "inactive") recorder.stop();
      }

      if (localRecordingObjectUrlRef.current) {
        URL.revokeObjectURL(localRecordingObjectUrlRef.current);
        localRecordingObjectUrlRef.current = null;
      }
    };
  }, []);

  const cameraItems = useMemo(
    () =>
      cameras.map((camera, index) => ({
        ...camera,
        image: getCameraImage(camera, index),
      })),
    [cameras]
  );

  const selectedCamera = useMemo(
    () =>
      cameraItems.find((camera) => camera.id === selectedCameraId) ??
      cameraItems[0],
    [cameraItems, selectedCameraId]
  );

  const selectedCameraIndex = Math.max(
    0,
    cameraItems.findIndex((camera) => camera.id === selectedCamera?.id)
  );
  const selectedCameraImage = getCameraImage(selectedCamera, selectedCameraIndex);
  const selectedCameraOnline = isCameraOnline(selectedCamera);
  const selectedCameraUsesSavedLocalWebcam = selectedCamera?.sourceType === "local-webcam";
  const hlsMediaPathPreview = useMemo(() => {
    if (sourceType !== "hls") return null;
    const input = streamUrlInput.trim();
    if (!input) return null;
    return looksLikeUrl(input) ? extractMediaPathFromHlsUrl(input) : normalizeMediaPath(input);
  }, [sourceType, streamUrlInput]);
  const generatedHlsPreviewUrl = hlsMediaPathPreview ? buildGatewayHlsUrl(hlsMediaPathPreview) : "";
  const localWebcamPaused = selectedCamera ? pausedLocalWebcamByCameraId[selectedCamera.id] === true : false;
  const localWebcamActive = !!selectedCamera && (
    localWebcamCameraId === selectedCamera.id ||
    (selectedCameraUsesSavedLocalWebcam && !localWebcamPaused)
  );
  const playerCanInteract = selectedCameraOnline || localWebcamActive;
  const selectedCameraLogs = logs.filter(
    (log) => log.cameraId === selectedCamera?.id
  );
  const displayLogs = selectedCameraLogs.length > 0 ? selectedCameraLogs : logs;
  const activityItems = toActivityItems(displayLogs, FALLBACK_ACTIVITIES);
  const quickRecordingItems = toQuickRecordingItems(recordings);
  const activeRecording = recordings.find(
    (recording) => recording.cameraId === selectedCamera?.id
  );
  const latestLog = displayLogs[0];
  const activeTriggerLogs = useMemo(() => getActiveTriggerLogs(logs), [logs]);
  const triggerLogByCameraId = useMemo(() => {
    const triggerMap = new Map<string, BullyingLog>();
    activeTriggerLogs.forEach((log) => {
      if (!triggerMap.has(log.cameraId)) triggerMap.set(log.cameraId, log);
    });
    return triggerMap;
  }, [activeTriggerLogs]);
  const selectedTriggerLog = selectedCamera
    ? triggerLogByCameraId.get(selectedCamera.id) ?? null
    : null;

  const selectedTriggerMarkerPercent = selectedTriggerLog
    ? getLiveEventMarkerPercent(selectedTriggerLog.timestamp, now)
    : null;
  const visibleCameraItems = cameraItems;
  const playerIsPlaying = playerCanInteract && isPlaying;
  const liveTimelineProgressPercent = playerCanInteract ? (playerIsPlaying ? 100 : 45) : 0;
  const liveTimelineIsAtLiveEdge = liveTimelineProgressPercent === 100;
  const localRecordingIsActive = localRecordingState === "recording";
  const localRecordingCanStart = localWebcamActive && playerCanInteract;
  const liveStatusLabel = getLiveStatusLabel({
    playerCanInteract,
    playerIsPlaying,
  });
  const liveStatusDotClass = getLiveStatusDotClass({
    playerCanInteract,
    playerIsPlaying,
    hasTrigger: !!selectedTriggerLog,
  });
  const selectedCameraDisplayStatus = localWebcamActive
    ? "Webcam Lokal"
    : cameraStatusLabel(selectedCamera);
  const selectedVideoDeviceId = selectedCamera
    ? localDeviceByCameraId[selectedCamera.id] ?? ""
    : "";
  const selectedLocalDeviceId = localWebcamActive
    ? selectedVideoDeviceId || undefined
    : undefined;

  const handleLocalDevicesChange = useCallback((devices: LocalVideoDevice[]) => {
    setVideoDevices(devices);
    const cameraId = selectedCamera?.id;
    if (!cameraId) return;

    setLocalDeviceByCameraId((current) => {
      const currentDeviceId = current[cameraId] ?? "";
      if (currentDeviceId && devices.some((device) => device.deviceId === currentDeviceId)) {
        return current;
      }

      const nextDeviceId = devices[0]?.deviceId ?? "";
      if (currentDeviceId === nextDeviceId) return current;
      return { ...current, [cameraId]: nextDeviceId };
    });
  }, [selectedCamera?.id]);

  const handleLocalStatusChange = useCallback((status: LiveCameraPlayerStatus) => {
    if (status.state === "preview" && sourceType === "local-webcam" && !localWebcamActive) {
      return;
    }

    setSourceStatusState(status.state);
    setSourceMessage(status.message);
  }, [localWebcamActive, setSourceMessage, setSourceStatusState, sourceType]);

  const refreshVideoDevices = useCallback(async () => {
    setIsRefreshingDevices(true);
    setSourceStatusState("starting");

    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setSourceStatusState("unsupported");
        setSourceMessage("Browser belum mendukung daftar kamera lokal.");
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Kamera ${index + 1}`,
        }));

      handleLocalDevicesChange(videoInputs);
      setSourceStatusState(videoInputs.length > 0 ? "active" : "missing");
      setSourceMessage(
        videoInputs.length > 0
          ? `${videoInputs.length} kamera lokal terdeteksi.`
          : "Belum ada kamera lokal terdeteksi."
      );
    } catch (error) {
      setSourceStatusState("error");
      setSourceMessage(error instanceof Error ? error.message : "Daftar kamera lokal belum bisa dimuat.");
    } finally {
      setIsRefreshingDevices(false);
    }
  }, [handleLocalDevicesChange, setIsRefreshingDevices, setSourceMessage, setSourceStatusState]);

  useEffect(() => {
    if (!selectedCamera) return;

    const timeout = window.setTimeout(() => {
      const cameraChanged = previousSelectedCameraIdRef.current !== selectedCamera.id;
      previousSelectedCameraIdRef.current = selectedCamera.id;

      setSourceType(selectedCamera.sourceType ?? "mock");
      setStreamUrlInput(getCameraSourceInputValue(selectedCamera));

      if (selectedCamera.sourceType === "local-webcam") {
        const blockMessage = getLocalWebcamBlockMessage();
        if (blockMessage) {
          setLocalWebcamCameraId(null);
          setSourceStatusState("error");
          setSourceMessage(blockMessage);
          return;
        }

        setIsPlaying(true);
        setLocalWebcamCameraId(selectedCamera.id);
        setSourceStatusState("starting");
        if (cameraChanged) setSourceMessage("Mengaktifkan webcam lokal...");
        void refreshVideoDevices();
        return;
      }

      if (cameraChanged) {
        setSourceStatusState(selectedCamera.streamUrl ? "active" : "preview");
        setSourceMessage("");
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refreshVideoDevices, selectedCamera]);


  const handleSnapshot = () => {
    if (!selectedCamera || !playerCanInteract) return;

    const media = videoContainerRef.current?.querySelector("[data-live-media='primary']") as HTMLVideoElement | HTMLImageElement | null;
    const liveCanvas = document.createElement("canvas");
    const liveContext = liveCanvas.getContext("2d");

    if (media && liveContext) {
      try {
        if (media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0) {
          liveCanvas.width = media.videoWidth;
          liveCanvas.height = media.videoHeight;
          liveContext.drawImage(media, 0, 0, liveCanvas.width, liveCanvas.height);
          downloadSnapshot(liveCanvas, selectedCamera.id);
          return;
        }

        if (media instanceof HTMLImageElement && media.complete && media.naturalWidth > 0) {
          liveCanvas.width = media.naturalWidth;
          liveCanvas.height = media.naturalHeight;
          liveContext.drawImage(media, 0, 0, liveCanvas.width, liveCanvas.height);
          downloadSnapshot(liveCanvas, selectedCamera.id);
          return;
        }
      } catch {
        // Cross-origin image streams can taint canvas; fallback keeps snapshot available.
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#1d4ed8";
    context.fillRect(0, 0, canvas.width, 12);
    context.fillStyle = "#ffffff";
    context.font = "bold 44px Arial";
    context.fillText(selectedCamera.name, 64, 100);
    context.font = "26px Arial";
    context.fillText(`${selectedCamera.location} - ${formatDisplayDate(now)} ${formatClock(now)} WIB`, 64, 146);
    context.fillStyle = "rgba(255,255,255,0.12)";
    context.fillRect(64, 210, 1152, 360);
    context.fillStyle = "#bfdbfe";
    context.font = "bold 34px Arial";
    context.fillText("BRAVE AI CCTV SNAPSHOT", 64, 650);

    downloadSnapshot(canvas, selectedCamera.id);
  };

  const handleSaveRecording = async () => {
    if (!selectedCamera) return;
    if (!selectedCameraOnline) {
      window.alert("Kamera sedang offline, rekaman belum bisa disimpan.");
      return;
    }
    if (!activeRecording) {
      window.alert("Belum ada rekaman insiden untuk kamera ini.");
      return;
    }

    const { startTime, endTime } = getEvidenceClipWindow(
      selectedTriggerLog?.timestamp ?? latestLog?.timestamp ?? now.toISOString()
    );

    try {
      const clip = await createEvidenceClip(activeRecording.id, {
        cameraId: selectedCamera.id,
        startTime,
        endTime,
        reason: "manual_live_view_save",
      });
      window.alert(
        `Clip bukti ${clip.id} masuk antrean export: 30 detik sebelum dan 30 detik sesudah kejadian.`
      );
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Rekaman belum bisa disimpan."
      );
    }
  };

  const clearLocalRecordingTimer = () => {
    if (localRecordingTimerRef.current !== null) {
      window.clearInterval(localRecordingTimerRef.current);
      localRecordingTimerRef.current = null;
    }
  };

  const stopLocalBrowserRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    setLocalRecordingMessage("Menyelesaikan rekaman lokal...");
    recorder.stop();
  };

  const startLocalBrowserRecording = () => {
    if (!selectedCamera) return;

    if (!localWebcamActive) {
      setLocalRecordingState("error");
      setLocalRecordingMessage("Aktifkan Webcam Lokal dulu untuk merekam clip MVP dari perangkat ini.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setLocalRecordingState("error");
      setLocalRecordingMessage("Browser ini belum mendukung perekaman video lokal.");
      return;
    }

    const stream = getActiveLocalMediaStream(videoContainerRef.current);
    if (!stream) {
      setLocalRecordingState("error");
      setLocalRecordingMessage("Stream webcam belum aktif. Tekan Webcam Lokal, izinkan kamera, lalu coba rekam lagi.");
      return;
    }

    const mimeType = getSupportedBrowserRecordingMimeType();
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (error) {
      setLocalRecordingState("error");
      setLocalRecordingMessage(error instanceof Error ? error.message : "Recorder lokal gagal dibuat.");
      return;
    }

    if (localRecordingObjectUrlRef.current) {
      URL.revokeObjectURL(localRecordingObjectUrlRef.current);
      localRecordingObjectUrlRef.current = null;
    }

    const startTime = new Date();
    const session = {
      cameraId: selectedCamera.id,
      cameraName: selectedCamera.name,
      recordingId: activeRecording?.id ?? null,
      startTime: startTime.toISOString(),
    };

    recordingChunksRef.current = [];
    mediaRecorderRef.current = recorder;
    setIsPlaying(true);
    setLocalRecordingState("recording");
    setLocalRecordingStartedAt(session.startTime);
    setLocalRecordingElapsed(0);
    setLocalRecordingResult(null);
    setLocalRecordingMessage(`Merekam clip lokal dari ${session.cameraName}.`);

    clearLocalRecordingTimer();
    localRecordingTimerRef.current = window.setInterval(() => {
      setLocalRecordingElapsed(Math.max(0, Math.floor((Date.now() - startTime.getTime()) / 1000)));
    }, 1000);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      clearLocalRecordingTimer();
      setLocalRecordingState("error");
      setLocalRecordingMessage("Rekaman lokal berhenti karena error dari browser.");
      mediaRecorderRef.current = null;
    };

    recorder.onstop = () => {
      clearLocalRecordingTimer();
      mediaRecorderRef.current = null;

      const chunks = recordingChunksRef.current;
      recordingChunksRef.current = [];
      const endTime = new Date();
      const duration = Math.max(1, Math.round((endTime.getTime() - startTime.getTime()) / 1000));

      if (chunks.length === 0) {
        setLocalRecordingState("error");
        setLocalRecordingMessage("Rekaman lokal kosong. Pastikan webcam masih aktif lalu coba lagi.");
        return;
      }

      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      const fileName = getLocalRecordingFileName(session.cameraName, startTime, blob.type);
      localRecordingObjectUrlRef.current = url;

      const result: LocalRecordingResult = {
        url,
        fileName,
        fileSize: blob.size,
        startTime: session.startTime,
        endTime: endTime.toISOString(),
        duration,
        mimeType: blob.type || "video/webm",
      };

      setLocalRecordingState("ready");
      setLocalRecordingStartedAt(null);
      setLocalRecordingElapsed(duration);
      setLocalRecordingResult(result);

      if (!session.recordingId) {
        setLocalRecordingMessage(`Clip lokal siap diunduh (${formatLocalRecordingDuration(duration)}, ${formatBytes(blob.size)}). Metadata backend belum dikirim karena belum ada recording aktif.`);
        return;
      }

      setLocalRecordingMessage(`Clip lokal siap diunduh (${formatLocalRecordingDuration(duration)}, ${formatBytes(blob.size)}). Mengirim metadata ke backend...`);
      void createEvidenceClip(session.recordingId, {
        cameraId: session.cameraId,
        startTime: session.startTime,
        endTime: endTime.toISOString(),
        reason: "local_webcam_mvp_recording",
      })
        .then((clip) => {
          setLocalRecordingResult((current) => current?.url === url ? { ...current, backendClipId: clip.id } : current);
          setLocalRecordingMessage(`Clip lokal siap diunduh. Metadata backend masuk antrean evidence clip ${clip.id}.`);
        })
        .catch((error) => {
          setLocalRecordingMessage(error instanceof Error
            ? `Clip lokal siap diunduh, tapi metadata backend gagal: ${error.message}`
            : "Clip lokal siap diunduh, tapi metadata backend gagal dikirim."
          );
        });
    };

    try {
      recorder.start(1000);
    } catch (error) {
      clearLocalRecordingTimer();
      mediaRecorderRef.current = null;
      setLocalRecordingState("error");
      setLocalRecordingMessage(error instanceof Error ? error.message : "Rekaman lokal gagal dimulai.");
    }
  };

  const handleToggleLocalRecording = () => {
    if (localRecordingIsActive) {
      stopLocalBrowserRecording();
      return;
    }

    startLocalBrowserRecording();
  };

  const handleDownloadLocalRecording = () => {
    if (!localRecordingResult) return;

    const link = document.createElement("a");
    link.href = localRecordingResult.url;
    link.download = localRecordingResult.fileName;
    link.click();
  };

  const handleActivityClick = async (activityId: string) => {
    const sourceLog = logs.find((log) => log.id === activityId);
    if (!sourceLog) {
      window.alert("Aktivitas ini belum tersambung ke data kejadian backend.");
      return;
    }

    setSelectedCameraId(sourceLog.cameraId);

    let recording =
      recordings.find((item) => item.id === sourceLog.recordingId) ??
      recordings.find((item) => item.cameraId === sourceLog.cameraId && item.hasIncident);

    if (!recording && sourceLog.recordingId) {
      recording = await getRecordingById(sourceLog.recordingId);
    }

    if (!recording) {
      window.alert("Belum ada rekaman terkait untuk aktivitas ini.");
      return;
    }

    if (recording.storageStatus === "unavailable") {
      window.alert("Rekaman terkait sedang tidak tersedia dari NVR/DVR.");
      return;
    }

    const { startTime, endTime } = getEvidenceClipWindow(sourceLog.timestamp);

    try {
      const clip = await createEvidenceClip(recording.id, {
        cameraId: sourceLog.cameraId,
        startTime,
        endTime,
        reason: "activity_incident_quick_clip",
      });
      window.alert(
        `Clip bukti ${clip.id} masuk antrean export: 30 detik sebelum dan 30 detik sesudah kejadian.`
      );
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Clip bukti belum bisa dibuat dari aktivitas ini."
      );
    }
  };
  const handleToggleLocalWebcam = () => {
    if (!selectedCamera) return;

    if (localWebcamActive) {
      if (localRecordingIsActive) stopLocalBrowserRecording();
      setLocalWebcamCameraId(null);
      setPausedLocalWebcamByCameraId((current) => ({ ...current, [selectedCamera.id]: true }));
      setSourceStatusState("stopped");
      setSourceMessage("Webcam lokal dimatikan.");
      return;
    }

    const blockMessage = getLocalWebcamBlockMessage();
    if (blockMessage) {
      setSourceStatusState("error");
      setSourceMessage(blockMessage);
      return;
    }

    setIsPlaying(true);
    setPausedLocalWebcamByCameraId((current) => ({ ...current, [selectedCamera.id]: false }));
    setSourceType("local-webcam");
    setStreamUrlInput("");
    setSourceStatusState("starting");
    setSourceMessage("Mengaktifkan webcam lokal...");
    setLocalWebcamCameraId(selectedCamera.id);
    void refreshVideoDevices();
  };
  const handleOpenCameraStation = () => {
    if (!selectedCamera) return;
    router.push(`/camera-station?cameraId=${encodeURIComponent(selectedCamera.id)}`);
  };
  const handleTestCameraSource = async () => {
    if (!selectedCamera) return;

    setIsTestingSource(true);
    setSourceStatusState("starting");
    setSourceMessage("Menguji sumber kamera...");

    try {
      const result = sourceType === "local-webcam"
        ? await testLocalWebcamSource({
            selectedDeviceId: selectedVideoDeviceId,
            isActive: localWebcamActive,
            container: videoContainerRef.current,
          })
        : await testRemoteCameraSource({
            sourceType,
            streamUrl: resolveCameraSourceTestUrl(sourceType, streamUrlInput),
          });

      setSourceStatusState(result.state);
      setSourceMessage(result.message);

      if (sourceType === "local-webcam" && result.state === "active") {
        void refreshVideoDevices();
      }
    } catch (error) {
      const result = getSourceTestErrorResult(error);
      setSourceStatusState(result.state);
      setSourceMessage(result.message);
    } finally {
      setIsTestingSource(false);
    }
  };
  const handleSaveCameraSource = async () => {
    if (!selectedCamera) return;
    setIsSavingSource(true);
    setSourceStatusState("starting");
    setSourceMessage("");

    try {
      const sourceUpdate = buildCameraSourceUpdate(sourceType, streamUrlInput);
      const updated = await updateCameraSource(selectedCamera.id, sourceUpdate);
      setCameras((current) => current.map((camera) => camera.id === updated.id ? updated : camera));
      setSourceType(updated.sourceType);
      setStreamUrlInput(getCameraSourceInputValue(updated));

      if (updated.sourceType === "local-webcam") {
        setIsPlaying(true);
        setPausedLocalWebcamByCameraId((current) => ({ ...current, [updated.id]: false }));
        setLocalWebcamCameraId(updated.id);
        setSourceStatusState("starting");
        setSourceMessage("Webcam lokal disimpan dan aktif di perangkat ini.");
        void refreshVideoDevices();
      } else {
        setLocalWebcamCameraId(null);
        setPausedLocalWebcamByCameraId((current) => ({ ...current, [updated.id]: false }));
        setSourceStatusState(getSavedSourceStatusState(updated.sourceType));
        setSourceMessage(getSourceSaveMessage(updated.sourceType));
      }
    } catch (error) {
      setSourceStatusState("error");
      setSourceMessage(error instanceof Error ? error.message : "Sumber kamera belum bisa disimpan.");
    } finally {
      setIsSavingSource(false);
    }
  };
  const handleOpenDevicePublisher = async () => {
    if (!selectedCamera) return;

    const mediaPath = getDevicePublisherMediaPath(selectedCamera);
    const existingPublisherWindow = publisherWindowsRef.current.get(mediaPath);
    if (existingPublisherWindow && !existingPublisherWindow.closed) {
      existingPublisherWindow.focus();
      setSourceStatusState("starting");
      setSourceMessage(`Publisher ${mediaPath} sudah terbuka. Aku fokuskan tab yang sama agar stream tidak saling memutus.`);
      return;
    }

    const publisherTarget = `brave-ai-publisher-${mediaPath.replace(/[^a-z0-9_-]/gi, "-")}`;
    const publisherWindow = typeof window !== "undefined" ? window.open("about:blank", publisherTarget) : null;
    if (!publisherWindow) {
      setSourceStatusState("error");
      setSourceMessage("Browser memblokir tab Publisher. Izinkan pop-up untuk BRAVE AI lalu coba lagi.");
      return;
    }

    publisherWindowsRef.current.set(mediaPath, publisherWindow);
    publisherWindow.opener = null;
    publisherWindow.document.body.innerHTML = '<p style="font-family: system-ui, sans-serif; padding: 24px; color: #0f172a;">Menyiapkan publisher kamera BRAVE AI...</p>';
    setIsOpeningPublisher(true);
    setSourceStatusState("starting");
    setSourceMessage("Menyiapkan perangkat ini sebagai kamera live lintas device...");

    try {
      const updated = await updateCameraSource(selectedCamera.id, {
        sourceType: "hls",
        streamUrl: null,
        mediaPath,
      });
      setCameras((current) => current.map((camera) => camera.id === updated.id ? updated : camera));
      setSourceType("hls");
      setStreamUrlInput(getCameraSourceInputValue(updated));
      setLocalWebcamCameraId(null);
      setPausedLocalWebcamByCameraId((current) => ({ ...current, [updated.id]: false }));

      const publisherUrl = buildGatewayWebRtcPublisherUrl(mediaPath);
      if (publisherWindow) {
        publisherWindow.location.href = publisherUrl;
      } else if (typeof window !== "undefined") {
        window.open(publisherUrl, "_blank", "noopener,noreferrer");
      }

      setSourceStatusState("starting");
      setSourceMessage(`Publisher kamera dibuka untuk ${mediaPath}. Gunakan satu tab/perangkat publisher untuk channel ini agar stream tetap stabil.`);
    } catch (error) {
      publisherWindow?.close();
      publisherWindowsRef.current.delete(mediaPath);
      setSourceStatusState("error");
      setSourceMessage(error instanceof Error ? error.message : "Publisher kamera belum bisa dibuka.");
    } finally {
      setIsOpeningPublisher(false);
    }
  };
  const handleCopyRaspberryPiCommand = async () => {
    if (!selectedCamera) return;

    const mediaPath = getDevicePublisherMediaPath(selectedCamera);
    setIsCopyingPiCommand(true);
    setSourceStatusState("starting");
    setSourceMessage("Menyiapkan command Raspberry Pi...");

    try {
      const updated = await updateCameraSource(selectedCamera.id, {
        sourceType: "hls",
        streamUrl: null,
        mediaPath,
      });
      setCameras((current) => current.map((camera) => camera.id === updated.id ? updated : camera));
      setSourceType("hls");
      setStreamUrlInput(getCameraSourceInputValue(updated));
      setLocalWebcamCameraId(null);
      setPausedLocalWebcamByCameraId((current) => ({ ...current, [updated.id]: false }));

      const command = buildRaspberryPiInstallCommand(mediaPath);
      setPiCommandModal({ command, mediaPath });
      setSourceStatusState("active");
      setSourceMessage(`Command Raspberry Pi untuk ${mediaPath} sudah disiapkan.`);
    } catch (error) {
      setSourceStatusState("error");
      setSourceMessage(error instanceof Error ? error.message : "Command Raspberry Pi belum bisa disalin.");
    } finally {
      setIsCopyingPiCommand(false);
    }
  };
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await videoContainerRef.current?.requestFullscreen().catch(err => {
        console.error("Error attempting to enable full-screen mode:", err.message);
      });
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  };

  const activityTotalPages = Math.ceil(activityItems.length / 5);
  const activityPaginationItems = useMemo(() => {
    if (activityTotalPages <= 5) return Array.from({ length: activityTotalPages }, (_, i) => i + 1);
    if (activityPage <= 3) return [1, 2, 3, 4, '...', activityTotalPages];
    if (activityPage >= activityTotalPages - 2) return [1, '...', activityTotalPages - 3, activityTotalPages - 2, activityTotalPages - 1, activityTotalPages];
    return [1, '...', activityPage - 1, activityPage, activityPage + 1, '...', activityTotalPages];
  }, [activityPage, activityTotalPages]);

  return (
    <>
      <div className="min-h-screen bg-slate-50 -m-4 p-4 pwa:-m-6 pwa:p-6">
        {/* Mobile Top Bar */}
        <div className="flex lg:hidden items-center justify-between -mx-4 -mt-4 pwa:-mx-6 pwa:-mt-6 mb-6 px-4 py-3 pwa:px-6 pwa:py-4 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-sm sticky top-0 z-50 transform-gpu">
          {/* Hamburger Menu (only visible on tablet, 501px - 1023px) */}
          <div className="hidden pwa:flex items-center">
            <Sheet>
              <SheetTrigger render={<button className="p-2 -ml-2 rounded-lg hover:bg-slate-100 transition-colors" />}>
                <Menu className="w-6 h-6 text-[#1e293b]" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 bg-[#064eb7] border-white/[0.06] text-white">
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                <MobileSidebar />
              </SheetContent>
            </Sheet>
          </div>

          {/* Title for mobile inline with header */}
          <div className="flex flex-col flex-1 min-w-0 pr-4">
            <h1 className="text-[18px] pwa:text-[20px] font-bold text-[#0f172a] tracking-tight leading-none">Live Camera</h1>
            <p className="text-[11px] font-desc text-slate-500 mt-0.5 truncate">
              Pantau kamera sekolah secara real-time.
            </p>
          </div>

          <button onClick={() => router.push("/laporan")} className="relative p-2 rounded-full hover:bg-slate-100 transition-colors flex-shrink-0">
            <Bell className="w-6 h-6 text-[#1e293b]" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </div>

        <div className="max-w-7xl mx-auto space-y-6">
          {/* Desktop Header (fixed, sidebar-aware â€” only visible at lg when sidebar exists) */}
          <div className={cn(
            "hidden lg:flex fixed top-0 right-0 z-40 bg-white items-center justify-between h-16 px-6 lg:px-8 border-b border-slate-100 shadow-sm transition-[left] duration-300",
            isCollapsed ? "lg:left-20" : "lg:left-64"
          )}>
            <div>
              <h2 className="text-[15px] font-bold text-[#0f172a]">Live Camera</h2>
              <p className="text-[11px] font-desc text-slate-500 -mt-0.5">Pantau kamera sekolah secara real-time</p>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={() => router.push("/laporan")} className="relative flex items-center justify-center w-9 h-9 rounded-full bg-slate-50 border border-slate-100 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <Bell className="w-[18px] h-[18px]" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Spacer for fixed header on desktop (only when sidebar/header visible at lg) */}
          <div className="hidden lg:block h-10" />


          {/* Top Grid: Video Player (Left) & Detail Kamera (Right) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 pwa:gap-5 xl:gap-6">
            {/* Main Camera Player */}
            <div className="xl:col-span-8 bg-white rounded-[20px] pwa:rounded-[24px] border border-slate-100 shadow-sm p-3 pwa:p-4 lg:p-5 flex flex-col">
              <div className="flex flex-col pwa:flex-row pwa:items-center justify-between gap-2.5 pwa:gap-0 mb-3 pwa:mb-4 lg:mb-5">
                <div className="flex items-center justify-between gap-3 overflow-hidden">
                  <div className="flex items-center gap-2 pwa:gap-3 min-w-0">
                    <h2 className="text-[17px] pwa:text-[18px] md:text-[20px] lg:text-[22px] font-bold text-[#0f172a] tracking-tight truncate">{selectedCamera?.name ?? "Belum ada kamera"}</h2>
                  </div>
                </div>

                <div className="flex items-center justify-between pwa:justify-end gap-2 pwa:gap-3 lg:gap-5 flex-shrink-0 w-full pwa:w-auto">

                  {/* Date & Time Pill */}
                  <div className="flex items-center justify-center bg-slate-50 border border-slate-200/60 px-3 py-1.5 pwa:px-4 pwa:py-2 lg:px-5 lg:py-2.5 rounded-full shadow-sm">
                    {/* Date & Time */}
                    <div className="flex items-center gap-1.5 pwa:gap-2 lg:gap-3">
                      <div className="flex items-center gap-1 pwa:gap-1.5">
                        <Calendar className="w-3 h-3 pwa:w-3.5 pwa:h-3.5 text-slate-400" />
                        <span className="text-[10px] pwa:text-[11px] lg:text-[12px] font-medium text-slate-600 hidden pwa:block">{formatDisplayDate(now)}</span>
                        <span className="text-[10px] font-medium text-slate-600 pwa:hidden">{formatMobileDate(now)}</span>
                      </div>
                      <div className="w-1 h-1 rounded-full bg-slate-300" />
                      <div className="flex items-center gap-1 pwa:gap-1.5">
                        <Clock className="w-3 h-3 pwa:w-3.5 pwa:h-3.5 text-slate-400" />
                        <span className="text-[10px] pwa:text-[11px] lg:text-[13px] font-bold text-slate-800 font-mono tracking-tight">{formatClock(now)}</span>
                      </div>
                    </div>
                  </div>


                </div>
              </div>

              <div
                ref={videoContainerRef}
                className="relative w-full aspect-[4/3] pwa:aspect-[16/10] lg:aspect-[16/9] bg-[#1e293b] rounded-[14px] pwa:rounded-[16px] lg:rounded-[20px] overflow-hidden group"
              >
                <LiveCameraPlayer
                  camera={selectedCamera}
                  fallbackImage={selectedCameraImage}
                  isOnline={selectedCameraOnline}
                  isPlaying={playerIsPlaying}
                  isMuted={isMuted}
                  useLocalWebcam={localWebcamActive}
                  localDeviceId={selectedLocalDeviceId}
                  onLocalDevicesChange={handleLocalDevicesChange}
                  onLocalStatusChange={handleLocalStatusChange}
                />

                {/* Overlays */}
                <div className="absolute top-3 left-3 pwa:top-4 pwa:left-4">
                  <div className="bg-[#1c1c1c]/80 backdrop-blur-md px-2.5 py-1.5 pwa:px-3 pwa:py-1.5 rounded-lg flex items-center gap-1.5 pwa:gap-2">
                    <span className="text-white text-[11px] pwa:text-[12px] font-bold">{quality}</span>
                    <Signal className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 text-emerald-500" />
                  </div>
                </div>


                {selectedTriggerLog && (
                  <div className="absolute left-3 right-3 top-14 z-20 pwa:left-auto pwa:right-4 pwa:top-4 pwa:w-[360px]">
                    <div className="rounded-2xl border border-red-400/40 bg-red-950/85 p-3 text-white shadow-2xl backdrop-blur-md">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-950/40">
                          <ShieldAlert className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[12px] pwa:text-[13px] font-extrabold tracking-tight">
                              Indikasi perundungan terdeteksi
                            </p>
                            <span className="hidden rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-red-50 pwa:inline">
                              {Math.round(selectedTriggerLog.confidence * 100)}%
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] pwa:text-[11px] font-medium text-red-50/85">
                            {selectedTriggerLog.title} - {formatClock(selectedTriggerLog.timestamp)} WIB
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => void handleSaveRecording()}
                          disabled={!selectedCameraOnline || !activeRecording}
                          className="flex-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:bg-white/20 disabled:text-white/45"
                        >
                          Simpan Bukti
                        </button>
                        <button
                          onClick={() => router.push(`/laporan?logId=${encodeURIComponent(selectedTriggerLog.id)}`)}
                          className="flex-1 rounded-lg border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-white/20"
                        >
                          Buat Laporan
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {/* Controls Bar */}
                <div className="absolute bottom-3 left-3 right-3 pwa:bottom-4 pwa:left-4 pwa:right-4 bg-[#1a1a1a] rounded-[12px] pwa:rounded-[16px] px-3.5 py-2.5 pwa:px-4 pwa:py-3 flex items-center gap-3 pwa:gap-5">
                  <button onClick={() => setIsPlaying((value) => !value)} disabled={!playerCanInteract} title={playerIsPlaying ? "Pause preview" : "Lanjutkan preview"} className="text-white hover:text-blue-400 transition-colors disabled:text-white/35">
                    {playerIsPlaying ? <Pause className="w-4 h-4 pwa:w-5 pwa:h-5 fill-current" /> : <Play className="w-4 h-4 pwa:w-5 pwa:h-5 fill-current" />}
                  </button>
                  <button onClick={() => setIsMuted((value) => !value)} disabled={!playerCanInteract} className="text-white hover:text-blue-400 transition-colors">
                    {isMuted ? <VolumeX className="w-4 h-4 pwa:w-5 pwa:h-5" /> : <Volume2 className="w-4 h-4 pwa:w-5 pwa:h-5" />}
                  </button>
                  <button onClick={() => setQuality((value) => value === "HD" ? "SD" : "HD")} disabled={!playerCanInteract} className="px-1.5 py-0.5 border border-white/30 rounded font-bold text-white text-[10px] pwa:text-[11px]">{quality}</button>


                  {/* Timeline */}
                  <div className="flex-1 flex items-center gap-2 px-1">
                    <div className="h-1 pwa:h-1.5 flex-1 bg-white/20 rounded-full relative cursor-pointer">
                      <div
                        className="absolute left-0 top-0 bottom-0 rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
                        style={{ width: `${liveTimelineProgressPercent}%` }}
                      />
                      {playerCanInteract && (
                        <div
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 pwa:w-3 pwa:h-3 rounded-full bg-white pwa:bg-blue-600 shadow-md transition-[left,right] duration-300 ease-out",
                            liveTimelineIsAtLiveEdge ? "right-0" : "-translate-x-1/2"
                          )}
                          style={liveTimelineIsAtLiveEdge ? undefined : { left: `${liveTimelineProgressPercent}%` }}
                        />
                      )}
                      {selectedTriggerLog && selectedTriggerMarkerPercent !== null && (
                        <div
                          className="absolute top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-white shadow-lg shadow-red-950/40 pwa:h-3.5 pwa:w-3.5"
                          style={{ left: `${selectedTriggerMarkerPercent}%` }}
                          title={`Indikasi pada ${formatClock(selectedTriggerLog.timestamp)} WIB`}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pwa:gap-2">
                    <div className={cn("w-1.5 h-1.5 pwa:w-2 pwa:h-2 rounded-full", liveStatusDotClass)} />
                    <span className="text-[11px] pwa:text-[12px] font-bold text-white tracking-wider">{liveStatusLabel}</span>
                  </div>
                  <button onClick={toggleFullscreen} className="text-white hover:text-blue-400 transition-colors ml-1 pwa:ml-2">
                    {isFullscreen ? <Minimize className="w-4 h-4 pwa:w-5 pwa:h-5" /> : <Maximize className="w-4 h-4 pwa:w-5 pwa:h-5" />}
                  </button>
                </div>
              </div>

              {/* Dashboard Bawah: Informasi & Konfigurasi */}
              <div className="mt-4 lg:mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5">

                {/* Card 1: Informasi Kamera & Aksi */}
                <div className="flex flex-col justify-between rounded-[16px] border border-slate-100 bg-slate-50/50 p-4 lg:p-5">
                  <div>
                    <h3 className="text-[13px] lg:text-[14px] font-bold text-[#1e293b] mb-4">Informasi Kamera</h3>
                    <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                      <div>
                        <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5">Status</p>
                        <div className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span className="text-[12px] pwa:text-[13px] font-semibold text-[#1e293b] leading-tight break-words">{selectedCameraDisplayStatus}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5">Lokasi</p>
                        <div className="flex items-start gap-1.5">
                          <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                          <span className="text-[12px] pwa:text-[13px] font-semibold text-[#1e293b] leading-tight break-words">{selectedCamera?.location ?? "-"}</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5">Terakhir Aktif</p>
                        <div className="flex items-start gap-1.5">
                          <Clock className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                          <span className="text-[12px] pwa:text-[13px] font-semibold text-[#1e293b] leading-tight">
                            {formatDisplayDate(selectedCamera?.lastActive)}<br/>{formatClock(selectedCamera?.lastActive)} WIB
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] pwa:text-[12px] font-medium text-slate-500 mb-1.5">Penyimpanan</p>
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                          <span className="text-[12px] pwa:text-[13px] font-semibold text-[#1e293b]">Aman</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2.5 pt-4 border-t border-slate-200/60">
                    <button onClick={() => void handleSaveRecording()} disabled={!selectedCameraOnline} className="flex-1 min-w-[130px] flex items-center justify-center gap-1.5 pwa:gap-2 px-3 py-2.5 bg-[#fb3b6e] hover:bg-[#eb2a5d] text-white rounded-xl font-bold text-[11px] pwa:text-[12px] transition-colors shadow-sm whitespace-nowrap disabled:bg-slate-300 disabled:text-slate-500">
                      <span className="flex w-3.5 h-3.5 pwa:w-4 pwa:h-4 rounded-full border-[1.5px] border-white items-center justify-center flex-shrink-0">
                        <span className="w-1 h-1 pwa:w-1.5 pwa:h-1.5 bg-white rounded-full"></span>
                      </span>
                      Simpan Rekaman
                    </button>
                    <button onClick={handleSnapshot} disabled={!playerCanInteract} className="flex-1 min-w-[100px] flex items-center justify-center gap-1.5 pwa:gap-2 px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl font-bold text-[11px] pwa:text-[12px] transition-colors whitespace-nowrap shadow-sm disabled:bg-slate-100 disabled:text-slate-400">
                      <Camera className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 flex-shrink-0 text-slate-500" />
                      Snapshot
                    </button>
                    <button
                      onClick={handleToggleLocalRecording}
                      disabled={!localRecordingCanStart && !localRecordingIsActive}
                      className={cn(
                        "flex-1 min-w-[120px] flex items-center justify-center gap-1.5 pwa:gap-2 px-3 py-2.5 rounded-xl font-bold text-[11px] pwa:text-[12px] transition-colors whitespace-nowrap shadow-sm",
                        localRecordingIsActive
                          ? "bg-red-600 text-white hover:bg-red-700"
                          : "bg-white text-red-600 border border-red-100 hover:bg-red-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200"
                      )}
                    >
                      {localRecordingIsActive ? (
                        <Square className="w-3.5 h-3.5 pwa:w-4 pwa:h-4 flex-shrink-0 fill-current" />
                      ) : (
                        <span className="h-3 w-3 pwa:h-3.5 pwa:w-3.5 rounded-full border-[1.5px] pwa:border-2 border-current flex-shrink-0" />
                      )}
                      {localRecordingIsActive ? `Stop ${formatLocalRecordingDuration(localRecordingElapsed)}` : "Mulai Rekam"}
                    </button>
                  </div>

                  {localRecordingMessage && (
                    <div className={cn("mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5", getLocalRecordingStatusContainerClass(localRecordingState))}>
                      <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", getLocalRecordingStatusDotClass(localRecordingState))} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] pwa:text-[12px] font-medium leading-relaxed">
                          {localRecordingIsActive && localRecordingStartedAt
                            ? `Merekam sejak ${formatClock(localRecordingStartedAt)} WIB - ${formatLocalRecordingDuration(localRecordingElapsed)}`
                            : localRecordingMessage}
                        </p>
                        {localRecordingResult && (
                          <p className="mt-1 text-[10px] font-semibold opacity-80">
                            {formatLocalRecordingDuration(localRecordingResult.duration)} - {formatBytes(localRecordingResult.fileSize)}{localRecordingResult.backendClipId ? ` - evidence ${localRecordingResult.backendClipId}` : ""}
                          </p>
                        )}
                      </div>
                      {localRecordingResult && (
                        <button onClick={handleDownloadLocalRecording} className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-bold shadow-sm transition-colors hover:bg-white">
                          <Download className="h-3.5 w-3.5" />
                          Unduh
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Card 2: Pengaturan Sumber Video */}
                <div className="flex flex-col justify-between rounded-[16px] border border-slate-100 bg-slate-50/50 p-4 lg:p-5">
                  <div>
                    <h3 className="text-[13px] lg:text-[14px] font-bold text-[#1e293b] mb-3">Sumber Video</h3>

                    {/* Tab Bar */}
                    <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
                      {(["stream", "webcam", "advanced"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setSourceTab(tab)}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] pwa:text-[12px] font-bold transition-all",
                            sourceTab === tab
                              ? "bg-white text-[#1e293b] shadow-sm"
                              : "text-slate-500 hover:text-slate-700"
                          )}
                        >
                          {tab === "stream" && <><Signal className="w-3.5 h-3.5" /> <span className="hidden pwa:inline">Stream URL</span><span className="pwa:hidden">Stream</span></>}
                          {tab === "webcam" && <><Smartphone className="w-3.5 h-3.5" /> Webcam</>}
                          {tab === "advanced" && <><MonitorUp className="w-3.5 h-3.5" /> <span className="hidden pwa:inline">Lanjutan</span><span className="pwa:hidden">More</span></>}
                        </button>
                      ))}
                    </div>

                    {/* Tab: Stream URL */}
                    {sourceTab === "stream" && (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col sm:flex-row gap-2.5">
                          <Popover open={isSourceTypeOpen} onOpenChange={setIsSourceTypeOpen}>
                            <PopoverTrigger className="flex items-center justify-between gap-1.5 pwa:gap-2 px-3 py-2 bg-white border border-slate-200 shadow-sm rounded-xl text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors w-full sm:w-[160px] flex-shrink-0 h-[40px] outline-none focus-visible:ring-4 focus-visible:ring-blue-100 focus-visible:border-blue-400">
                              <span className="truncate">{getSourceLabel(sourceType) || "Pilih Sumber"}</span>
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            </PopoverTrigger>
                            <PopoverContent className="w-[200px] p-1.5 bg-white border border-slate-200 shadow-lg rounded-xl" align="start">
                              {(["mock", "local-webcam", "hls", "direct-video", "phone-webcam", "rtsp", "nvr", "webrtc"] as CameraSourceType[]).map((val) => (
                                <button
                                  key={val}
                                  onClick={() => {
                                    setSourceType(val);
                                    if (val === "local-webcam") {
                                      setStreamUrlInput("");
                                      setSourceStatusState("idle");
                                      setSourceMessage("Pilih Simpan atau Webcam Lokal untuk memakai kamera perangkat ini.");
                                      setSourceTab("webcam");
                                    }
                                    setIsSourceTypeOpen(false);
                                  }}
                                  className={cn(
                                    "flex items-center justify-between w-full px-3 py-2 text-[12px] rounded-lg transition-colors text-left mt-0.5 first:mt-0",
                                    sourceType === val ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700 hover:bg-slate-50 font-medium"
                                  )}
                                >
                                  {getSourceLabel(val)}
                                  {sourceType === val && <Check className="w-3.5 h-3.5 text-blue-600 ml-2 flex-shrink-0" />}
                                </button>
                              ))}
                            </PopoverContent>
                          </Popover>

                          <input
                            value={streamUrlInput}
                            onChange={(event) => setStreamUrlInput(event.target.value)}
                            disabled={sourceType === "local-webcam"}
                            placeholder={getSourceInputPlaceholder(sourceType)}
                            className={cn("w-full flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all h-[40px]", sourceType === "local-webcam" && "bg-slate-100 text-slate-400")}
                          />
                        </div>

                        {sourceType === "hls" && (
                          <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-[11px] font-medium leading-relaxed text-blue-800">
                            <p>
                              Masukkan media path MediaMTX, misalnya <span className="font-black">browser-cam-65c7f</span>. Jangan pilih RTSP untuk media path ini.
                            </p>
                            {generatedHlsPreviewUrl && (
                              <p className="mt-1 break-all text-blue-700">
                                URL HLS: <span className="font-semibold">{generatedHlsPreviewUrl}</span>
                              </p>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => void handleTestCameraSource()} disabled={!selectedCamera || isTestingSource} className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-100 bg-white px-4 py-2 text-[12px] font-bold text-blue-600 shadow-sm hover:bg-blue-50 disabled:bg-slate-100 disabled:text-slate-400 transition-colors flex-shrink-0 h-[38px] min-w-[80px]">
                            <Signal className={cn("w-3.5 h-3.5", isTestingSource && "animate-pulse")} />
                            <span>{isTestingSource ? "Testing" : "Test"}</span>
                          </button>
                          <button onClick={() => void handleSaveCameraSource()} disabled={!selectedCamera || isSavingSource} className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 transition-colors flex-shrink-0 h-[38px] min-w-[90px]">
                            <Save className="w-3.5 h-3.5" />
                            <span>{isSavingSource ? "Menyimpan" : "Simpan"}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tab: Webcam Lokal */}
                    {sourceTab === "webcam" && (
                      <div className="flex flex-col gap-3">
                        <p className="text-[11px] pwa:text-[12px] text-slate-500 font-medium leading-relaxed">
                          Gunakan kamera bawaan perangkat ini (laptop/HP) sebagai sumber video live.
                        </p>

                        <button
                          onClick={handleToggleLocalWebcam}
                          disabled={!selectedCamera}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-[13px] transition-all shadow-sm",
                            localWebcamActive
                              ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                              : "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500"
                          )}
                        >
                          <Smartphone className="w-4 h-4" />
                          {localWebcamActive ? "Matikan Webcam" : "Aktifkan Webcam"}
                        </button>

                        {(sourceType === "local-webcam" || localWebcamActive) && (
                          <div className="flex flex-col lg:flex-row gap-2.5">
                            <Popover open={isVideoDeviceOpen} onOpenChange={setIsVideoDeviceOpen}>
                              <PopoverTrigger className="flex items-center justify-between gap-1.5 pwa:gap-2 px-3 py-2 bg-white border border-slate-200 shadow-sm rounded-xl text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors w-full flex-1 min-w-0 h-[38px] outline-none focus-visible:ring-4 focus-visible:ring-blue-100 focus-visible:border-blue-400">
                                <span className="truncate">
                                  {videoDevices.find(d => d.deviceId === selectedVideoDeviceId)?.label || (selectedVideoDeviceId ? `Kamera ${selectedVideoDeviceId.substring(0, 5)}...` : "Kamera default browser")}
                                </span>
                                <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                              </PopoverTrigger>
                              <PopoverContent className="w-[300px] p-1.5 bg-white border border-slate-200 shadow-lg rounded-xl" align="start">
                                <button
                                  onClick={() => {
                                    if (!selectedCamera) return;
                                    setIsPlaying(true); setSourceStatusState("starting"); setSourceMessage("Mengganti kamera lokal...");
                                    setLocalDeviceByCameraId((current) => ({ ...current, [selectedCamera.id]: "" }));
                                    setIsVideoDeviceOpen(false);
                                  }}
                                  className={cn(
                                    "flex items-center justify-between w-full px-3 py-2 text-[12px] rounded-lg transition-colors text-left",
                                    !selectedVideoDeviceId ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700 hover:bg-slate-50 font-medium"
                                  )}
                                >
                                  Kamera default browser
                                  {!selectedVideoDeviceId && <Check className="w-3.5 h-3.5 text-blue-600 ml-2 flex-shrink-0" />}
                                </button>
                                {videoDevices.map((device) => (
                                  <button
                                    key={device.deviceId}
                                    onClick={() => {
                                      if (!selectedCamera) return;
                                      setIsPlaying(true); setSourceStatusState("starting"); setSourceMessage("Mengganti kamera lokal...");
                                      setLocalDeviceByCameraId((current) => ({ ...current, [selectedCamera.id]: device.deviceId }));
                                      setIsVideoDeviceOpen(false);
                                    }}
                                    className={cn(
                                      "flex items-center justify-between w-full px-3 py-2 text-[12px] rounded-lg transition-colors text-left mt-0.5",
                                      selectedVideoDeviceId === device.deviceId ? "bg-blue-50 text-blue-700 font-bold" : "text-slate-700 hover:bg-slate-50 font-medium"
                                    )}
                                  >
                                    <span className="truncate">{device.label || `Kamera ${device.deviceId.substring(0, 5)}...`}</span>
                                    {selectedVideoDeviceId === device.deviceId && <Check className="w-3.5 h-3.5 text-blue-600 ml-2 flex-shrink-0" />}
                                  </button>
                                ))}
                              </PopoverContent>
                            </Popover>
                            <button
                              onClick={() => void refreshVideoDevices()}
                              disabled={isRefreshingDevices}
                              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[12px] font-bold text-slate-600 hover:bg-slate-50 disabled:text-slate-400 transition-colors shadow-sm flex-shrink-0"
                            >
                              <RefreshCw className={cn("w-3.5 h-3.5", isRefreshingDevices && "animate-spin")} />
                              Refresh
                            </button>
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => void handleSaveCameraSource()} disabled={!selectedCamera || isSavingSource} className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 transition-colors flex-shrink-0 h-[38px] min-w-[90px]">
                            <Save className="w-3.5 h-3.5" />
                            <span>{isSavingSource ? "Menyimpan" : "Simpan"}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Tab: Pengaturan Lanjutan */}
                    {sourceTab === "advanced" && (
                      <div className="flex flex-col gap-3">
                        <p className="text-[11px] pwa:text-[12px] text-slate-500 font-medium leading-relaxed">
                          Opsi lanjutan untuk menghubungkan perangkat lain sebagai sumber kamera.
                        </p>

                        <div className="flex flex-col gap-2">
                          <button onClick={handleOpenCameraStation} disabled={!selectedCamera} className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 transition-colors shadow-sm text-left">
                            <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <MonitorUp className="w-4 h-4 text-emerald-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] pwa:text-[13px] font-bold text-[#1e293b]">Mode Station</p>
                              <p className="text-[10px] pwa:text-[11px] text-slate-500">Buka halaman kamera station khusus</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          </button>

                          <button onClick={() => void handleOpenDevicePublisher()} disabled={!selectedCamera || isOpeningPublisher || isSavingSource} className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 transition-colors shadow-sm text-left">
                            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Signal className={cn("w-4 h-4 text-blue-600", isOpeningPublisher && "animate-pulse")} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] pwa:text-[13px] font-bold text-[#1e293b]">{isOpeningPublisher ? "Membuka Publisher..." : "Jadikan Kamera"}</p>
                              <p className="text-[10px] pwa:text-[11px] text-slate-500">Buka WebRTC publisher dari perangkat ini</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          </button>

                          <button onClick={() => void handleCopyRaspberryPiCommand()} disabled={!selectedCamera || isCopyingPiCommand || isSavingSource} className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 transition-colors shadow-sm text-left">
                            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Copy className={cn("w-4 h-4 text-slate-600", isCopyingPiCommand && "animate-pulse")} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] pwa:text-[13px] font-bold text-[#1e293b]">{isCopyingPiCommand ? "Menyalin..." : "Copy Raspberry Pi"}</p>
                              <p className="text-[10px] pwa:text-[11px] text-slate-500">Salin command install untuk Raspberry Pi</p>
                            </div>
                            <Copy className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {sourceMessage && (
                    <div className={cn("mt-4 flex items-start gap-2.5 rounded-xl border px-3 py-2.5", getSourceStatusContainerClass(sourceStatusState))}>
                      <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", getSourceStatusDotClass(sourceStatusState))} />
                      <p className="text-[11px] pwa:text-[12px] font-medium leading-relaxed">{sourceMessage}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Daftar Kamera (Right on Desktop, Row 2 on Mobile/Tablet) */}
            <div className="xl:col-span-4 bg-white rounded-[20px] pwa:rounded-[24px] border border-slate-100 shadow-sm p-3 pwa:p-4 lg:p-5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-3 pwa:mb-4 gap-2">
                <h3 className="text-[14px] pwa:text-[15px] lg:text-[16px] font-bold text-[#1e293b] ">Daftar Kamera</h3>
              </div>

              <div className="flex md:grid md:grid-cols-2 xl:flex xl:flex-col overflow-x-auto md:overflow-visible xl:overflow-visible pb-3 md:pb-0 xl:pb-0 -mr-3 md:mr-0 xl:mr-0 pr-3 md:pr-0 xl:pr-0 gap-2.5 xl:gap-3 snap-x snap-mandatory md:snap-none xl:snap-none hide-scrollbar">
                {visibleCameraItems.length === 0 && (
                  <button
                    onClick={() => setIsAddCameraModalOpen(true)}
                    className="flex flex-col items-center justify-center p-6 text-center border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 rounded-xl bg-slate-50 transition-all cursor-pointer group w-full"
                  >
                    <div className="w-10 h-10 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <Plus className="w-5 h-5 text-blue-500" />
                    </div>
                    <p className="text-[13px] font-bold text-slate-700 group-hover:text-blue-700">Tambah Kamera Baru</p>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-[200px]">Klik di sini untuk menghubungkan kamera pertama Anda.</p>
                  </button>
                )}
                {visibleCameraItems.map((cam) => {
                  const isActive = cam.id === selectedCamera?.id;
                  const online = isCameraOnline(cam);
                  const triggerLog = triggerLogByCameraId.get(cam.id);

                  return (
                    <div
                      key={cam.id}
                      onClick={() => setSelectedCameraId(cam.id)}
                      className={cn(
                        "relative group flex flex-col md:flex-row xl:flex-row md:items-center xl:items-center justify-between gap-1.5 p-3 rounded-xl border transition-all cursor-pointer flex-shrink-0 snap-start w-[150px] pwa:w-[160px] md:w-full xl:w-full",
                        isActive ? "bg-blue-50 border-blue-200" : "bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <h4 className={cn("text-[12px] pwa:text-[13px] font-bold truncate text-left", isActive ? "text-blue-700" : "text-slate-800")}>{cam.name}</h4>
                        <p className="text-[11px] text-slate-500 truncate mb-1.5">{cam.location}</p>
                        <div className="flex items-center justify-start gap-1.5 flex-wrap">
                          {online ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-[10px] font-medium text-emerald-600">Online</span>
                            </>
                          ) : (
                            <>
                              <Circle className="w-3 h-3 text-red-500 fill-red-500" />
                              <span className="text-[10px] font-medium text-red-600">Offline</span>
                            </>
                          )}
                          {cam.sourceType === "local-webcam" && (
                            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">Webcam</span>
                          )}
                          {triggerLog && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">Tinjau AI</span>
                          )}
                        </div>
                      </div>
                      {isActive ? (
                        <div className="absolute bottom-2.5 right-2.5 md:static xl:static md:flex xl:flex md:items-center xl:items-center md:justify-center xl:justify-center flex-shrink-0 mt-0 md:ml-2 xl:ml-2">
                          <CheckCircle2 className="w-4 h-4 pwa:w-5 pwa:h-5 text-blue-600" />
                        </div>
                      ) : (
                        <div className="absolute bottom-2.5 right-2.5 md:static xl:static md:flex xl:flex md:items-center xl:items-center md:justify-center xl:justify-center flex-shrink-0 mt-0 md:ml-2 xl:ml-2">
                          <Play className="w-4 h-4 text-slate-400 opacity-50 transition-opacity group-hover:opacity-100" />
                        </div>
                      )}

                      <div className="absolute right-1 top-2 pwa:right-1.5 pwa:top-2 md:static xl:static md:right-auto xl:right-auto md:top-auto xl:top-auto flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Popover>
                          <PopoverTrigger className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors outline-none">
                            <MoreVertical className="w-4 h-4" />
                          </PopoverTrigger>
                          <PopoverContent className="w-40 p-1.5 bg-white border border-slate-200 shadow-md rounded-xl" align="end" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={(e) => handleDeleteCamera(e, cam.id)}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors text-left"
                            >
                              <Trash2 className="w-4 h-4" />
                              Hapus Kamera
                            </button>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  );
                })}

                {visibleCameraItems.length > 0 && (
                  <button
                    onClick={() => setIsAddCameraModalOpen(true)}
                    className="flex flex-col items-center md:flex-row xl:flex-row md:items-center xl:items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all cursor-pointer flex-shrink-0 snap-start w-[150px] pwa:w-[160px] md:w-full xl:w-full min-h-[72px] md:min-h-[64px] xl:min-h-[64px]"
                  >
                    <Plus className="w-5 h-5 text-slate-400" />
                    <span className="text-[12px] font-bold text-slate-500">Tambah Kamera</span>
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Bottom Section: Aktivitas & Indikasi Kejadian */}
          <div className="grid grid-cols-1 gap-6">

            {/* Aktivitas & Indikasi Kejadian */}
            <div className="flex flex-col gap-6">

              {/* Aktivitas Card */}
              <div className="bg-white rounded-[24px] border border-slate-100 shadow-sm p-4 pwa:p-6 flex flex-col">
                <div className="flex items-center justify-between mb-4 pwa:mb-5">
                  <h3 className="text-[15px] pwa:text-[16px] font-bold text-[#1e293b]">
                    <span className="hidden lg:inline">Aktivitas & Indikasi Kejadian</span>
                    <span className="lg:hidden">Aktivitas Terbaru</span>
                  </h3>
                </div>

                <div className="space-y-3 pwa:space-y-4">
                  {activityItems.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm font-medium text-slate-500">
                      Belum ada indikasi kejadian dari backend.
                    </div>
                  )}                  {activityItems.slice((activityPage - 1) * 5, activityPage * 5).map((log) => (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => void handleActivityClick(log.id)}
                      className="flex w-full items-center gap-3 pwa:gap-4 lg:gap-6 pb-3 pwa:pb-4 border-b border-slate-50 text-left transition-colors last:border-0 last:pb-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                    >
                      <div className="flex items-center gap-3 pwa:gap-4 flex-1 min-w-0">
                        <div className={`w-8 h-8 pwa:w-10 pwa:h-10 rounded-lg pwa:rounded-xl ${log.bg} flex items-center justify-center flex-shrink-0`}>
                          <ShieldAlert className={`w-4 h-4 pwa:w-5 pwa:h-5 ${log.color}`} />
                        </div>
                        <div className="flex flex-col pwa:flex-row pwa:items-center gap-1 pwa:gap-4 lg:gap-12 flex-1 min-w-0">
                          <div className="w-16 pwa:w-24 flex-shrink-0">
                            <p className="text-[11px] pwa:text-[13px] font-bold text-[#1e293b]">{log.time} WIB</p>
                            <p className="text-[11px] text-slate-500 hidden lg:block">{log.date}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-[#1e293b] hidden lg:flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-400 inline flex-shrink-0"/> <span className="break-words">{log.loc}</span></p>
                            <p className="text-[12px] font-bold text-[#1e293b] lg:hidden leading-snug break-words">{log.loc}</p>
                            <p className="text-[11px] text-slate-500 hidden lg:block leading-snug mt-0.5 break-words">{log.locationDetail}</p>
                            <p className="text-[10px] text-slate-500 lg:hidden leading-snug mt-0.5 break-words">{log.title}</p>
                          </div>
                          <div className="flex-1 min-w-0 hidden lg:block">
                            <p className="text-[13px] font-bold text-[#1e293b] leading-snug break-words">{log.title}</p>
                            <p className="text-[11px] text-slate-500 leading-snug mt-0.5 break-words">{log.desc}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-[9px] pwa:text-[11px] px-2 py-0.5 pwa:px-3 pwa:py-1 rounded-full font-bold ${log.badge}`}>
                          {log.status}
                        </span>
                        <MoreVertical className="w-4 h-4 text-slate-400 lg:hidden ml-0.5" />
                      </div>
                    </button>
                  ))}
                </div>

                {activityItems.length > 5 && (
                  <div className="mt-4 pwa:mt-6 flex items-center justify-center gap-1 pwa:gap-1.5 pt-4 pwa:pt-5 border-t border-slate-100">
                    <button
                      onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                      disabled={activityPage === 1}
                      className="flex items-center justify-center h-8 px-2 pwa:px-2.5 text-[12px] pwa:text-[13px] font-medium rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-transparent transition-colors text-slate-700 gap-1"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden lg:inline">Prev</span>
                    </button>

                    {activityPaginationItems.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => typeof item === 'number' && setActivityPage(item)}
                        disabled={item === '...'}
                        className={cn(
                          "flex items-center justify-center w-8 h-8 text-[12px] pwa:text-[13px] font-medium rounded-md transition-colors",
                          activityPage === item
                            ? "border border-slate-200 bg-white shadow-sm text-slate-900 font-bold"
                            : item === '...'
                              ? "cursor-default text-slate-400"
                              : "text-slate-600 hover:bg-slate-100 border border-transparent"
                        )}
                      >
                        {item}
                      </button>
                    ))}

                    <button
                      onClick={() => setActivityPage((p) => Math.min(activityTotalPages, p + 1))}
                      disabled={activityPage === activityTotalPages}
                      className="flex items-center justify-center h-8 px-2 pwa:px-2.5 text-[12px] pwa:text-[13px] font-medium rounded-md hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-transparent transition-colors text-slate-700 gap-1"
                    >
                      <span className="hidden lg:inline">Next</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Rekaman Cepat */}
              <div className="hidden lg:flex bg-white rounded-[24px] border border-slate-100 shadow-sm p-6 flex-col">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-[16px] font-bold text-[#1e293b]">Rekaman Cepat (Clip Tersimpan Hari Ini)</h3>
                  <button onClick={() => router.push("/rekaman")} className="text-[13px] font-medium text-blue-600 hover:text-blue-700">Lihat Semua</button>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {quickRecordingItems.length === 0 && (
                    <div className="col-span-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4 text-sm font-medium text-slate-500">
                      Belum ada clip rekaman tersimpan hari ini.
                    </div>
                  )}                  {quickRecordingItems.map((rec) => (
                    <div key={rec.id} className="flex flex-col gap-2">
                      <div className="relative w-full aspect-[16/9] bg-slate-200 rounded-xl overflow-hidden group cursor-pointer">
                        <img src={rec.img} className="w-full h-full object-cover transition-transform group-hover:scale-105" alt="" />
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                          <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center border border-white/40">
                            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                          </div>
                        </div>
                        <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] px-2 py-0.5 rounded-md font-bold">
                          {rec.duration}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <div>
                          <h4 className="text-[12px] font-bold text-slate-500">{rec.time}</h4>
                          <p className="text-[13px] font-bold text-[#1e293b] truncate">{rec.title}</p>
                        </div>
                        <button onClick={() => router.push(`/rekaman?recordingId=${encodeURIComponent(rec.id)}`)} className="px-3 py-1.5 text-[11px] font-bold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
                          Lihat
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>



        </div>

        {/* Pi Command Modal */}
        {piCommandModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pwa:p-6">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={() => setPiCommandModal(null)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 pwa:p-5 border-b border-slate-100">
                <div>
                  <h3 className="text-[15px] pwa:text-[16px] font-bold text-slate-800">Command Raspberry Pi</h3>
                  <p className="text-[11px] pwa:text-[12px] text-slate-500 mt-1">Jalankan command ini di terminal Raspberry Pi Anda</p>
                </div>
                <button
                  onClick={() => setPiCommandModal(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors outline-none"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 pwa:p-5 bg-slate-50 flex flex-col gap-4">
                <div className="bg-[#0f172a] rounded-xl overflow-hidden shadow-inner border border-slate-700">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700/50">
                    <span className="text-[10px] font-medium text-slate-400 font-mono">bash</span>
                    <button
                      onClick={() => {
                        void copyTextToClipboard(piCommandModal.command);
                        setSourceStatusState("active");
                        setSourceMessage("Command berhasil disalin ke clipboard!");
                      }}
                      className="flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      <span className="text-[10px] font-medium">Copy</span>
                    </button>
                  </div>
                  <pre className="p-3 text-[11px] pwa:text-[12px] text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">{piCommandModal.command}</pre>
                </div>
                
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex gap-2.5 items-start">
                  <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] pwa:text-[12px] text-blue-800 leading-relaxed font-medium">
                    Setelah command dijalankan dan Raspberry Pi berhasil terhubung, stream video akan otomatis masuk ke kamera <span className="font-bold text-blue-900">{piCommandModal.mediaPath}</span>.
                  </p>
                </div>
              </div>
              
              <div className="p-4 pwa:p-5 border-t border-slate-100 flex justify-end gap-2 bg-white">
                <button
                  onClick={() => setPiCommandModal(null)}
                  className="px-4 py-2.5 text-[12px] pwa:text-[13px] font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Tutup
                </button>
                <button
                  onClick={() => {
                    void copyTextToClipboard(piCommandModal.command);
                    setPiCommandModal(null);
                    setSourceStatusState("active");
                    setSourceMessage("Command Raspberry Pi berhasil disalin ke clipboard!");
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 text-[12px] pwa:text-[13px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm"
                >
                  <Copy className="w-4 h-4" />
                  Copy & Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Camera Modal */}
        {isAddCameraModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={() => setIsAddCameraModalOpen(false)} />
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col transform transition-all duration-300 scale-100">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <h3 className="text-[16px] font-bold text-[#1e293b]">Tambah Kamera Baru</h3>
                <button
                  onClick={() => setIsAddCameraModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleAddCamera} className="p-5 flex flex-col gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Nama Kamera</label>
                  <input
                    type="text"
                    required
                    placeholder="Misal: Koridor Utama"
                    value={newCameraName}
                    onChange={(e) => setNewCameraName(e.target.value)}
                    className="w-full px-4 py-2.5 text-[14px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Lokasi</label>
                  <input
                    type="text"
                    required
                    placeholder="Misal: Gedung A Lt. 1"
                    value={newCameraLocation}
                    onChange={(e) => setNewCameraLocation(e.target.value)}
                    className="w-full px-4 py-2.5 text-[14px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 text-slate-800"
                  />
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAddCameraModalOpen(false)}
                    className="flex-1 px-4 py-2.5 text-[13px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingCamera || !newCameraName || !newCameraLocation}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-[13px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors shadow-sm"
                  >
                    {isSubmittingCamera && <Loader2 className="w-4 h-4 animate-spin" />}
                    Simpan Kamera
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      {/* Delete Camera Confirmation Modal */}
      {cameraToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-red-100">
                <Trash2 className="w-7 h-7 text-red-500" />
              </div>
              <h3 className="text-[18px] pwa:text-[20px] font-bold text-[#1e293b] mb-2">Hapus Kamera?</h3>
              <p className="text-[13px] pwa:text-[14px] text-slate-500 mb-6 leading-relaxed">
                Apakah Anda yakin ingin menghapus kamera ini? Semua data dan konfigurasi akan dihapus secara permanen.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setCameraToDelete(null)}
                  className="flex-1 py-3 text-[13px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={() => void confirmDeleteCamera()}
                  className="flex-1 py-3 text-[13px] font-bold text-white bg-red-600 hover:bg-red-700 shadow-sm shadow-red-600/20 rounded-xl transition-colors"
                >
                  Ya, Hapus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

const LIVE_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_CLIP_WINDOW_MS = 30 * 1000;

function getLiveEventMarkerPercent(timestamp: string, now: Date) {
  const eventMs = Date.parse(timestamp);
  if (!Number.isFinite(eventMs)) return null;

  const endMs = now.getTime();
  const startMs = endMs - LIVE_EVENT_WINDOW_MS;
  if (eventMs < startMs || eventMs > endMs) return null;

  const rawPercent = ((eventMs - startMs) / LIVE_EVENT_WINDOW_MS) * 100;
  return Math.min(98, Math.max(2, rawPercent));
}

type LiveStatusOptions = {
  playerCanInteract: boolean;
  playerIsPlaying: boolean;
};

function getLiveStatusLabel({
  playerCanInteract,
  playerIsPlaying,
}: LiveStatusOptions) {
  if (!playerCanInteract) return "OFFLINE";
  if (!playerIsPlaying) return "PAUSED";
  return "LIVE";
}

function getLiveStatusDotClass({
  playerCanInteract,
  playerIsPlaying,
  hasTrigger,
}: Pick<LiveStatusOptions, "playerCanInteract" | "playerIsPlaying"> & { hasTrigger: boolean }) {
  if (!playerCanInteract) return "bg-slate-500";
  if (!playerIsPlaying) return "bg-amber-400";
  if (hasTrigger) return "bg-red-500 animate-pulse";
  return "bg-red-500";
}

function getEvidenceClipWindow(timestamp: string) {
  const eventMs = Date.parse(timestamp);
  const centerMs = Number.isFinite(eventMs)
    ? eventMs
    : Date.parse(LIVE_VIEW_INITIAL_TIME_ISO);

  return {
    startTime: new Date(centerMs - EVIDENCE_CLIP_WINDOW_MS).toISOString(),
    endTime: new Date(centerMs + EVIDENCE_CLIP_WINDOW_MS).toISOString(),
  };
}

function getActiveTriggerLogs(logs: BullyingLog[]) {
  return logs
    .filter(isActiveAiTrigger)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
}

function isActiveAiTrigger(log: BullyingLog) {
  return (
    log.status !== "selesai" &&
    (log.severity === "medium" ||
      log.severity === "high" ||
      log.severity === "critical")
  );
}
function getActiveLocalMediaStream(container: HTMLDivElement | null) {
  const video = container?.querySelector("video[data-live-media='primary']") as HTMLVideoElement | null;
  const stream = video?.srcObject;

  if (!(stream instanceof MediaStream)) return null;
  if (!stream.active) return null;

  const hasLiveVideoTrack = stream.getVideoTracks().some((track) => track.readyState === "live");
  return hasLiveVideoTrack ? stream : null;
}

function getSupportedBrowserRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function getLocalRecordingFileName(cameraName: string, startTime: Date, mimeType: string) {
  const safeCameraName = cameraName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "camera";
  const timestamp = startTime.toISOString().replace(/[:.]/g, "-");
  const extension = mimeType.includes("mp4") ? "mp4" : "webm";
  return `brave-${safeCameraName}-${timestamp}.${extension}`;
}

function formatLocalRecordingDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function getLocalRecordingStatusContainerClass(state: LocalRecordingState) {
  if (state === "recording") return "border-red-100 bg-red-50 text-red-700";
  if (state === "ready") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (state === "error") return "border-red-100 bg-red-50 text-red-600";
  return "border-slate-100 bg-white text-slate-500";
}

function getLocalRecordingStatusDotClass(state: LocalRecordingState) {
  if (state === "recording") return "bg-red-500 animate-pulse";
  if (state === "ready") return "bg-emerald-500";
  if (state === "error") return "bg-red-500";
  return "bg-slate-300";
}

function downloadSnapshot(canvas: HTMLCanvasElement, cameraId: string) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `snapshot-${cameraId}-${Date.now()}.png`;
  link.click();
}

type SourceTestResult = {
  state: LiveCameraPlayerStatus["state"];
  message: string;
};

type TestLocalWebcamSourceOptions = {
  selectedDeviceId: string;
  isActive: boolean;
  container: HTMLDivElement | null;
};

type TestRemoteCameraSourceOptions = {
  sourceType: CameraSourceType;
  streamUrl: string;
};

async function testLocalWebcamSource({
  selectedDeviceId,
  isActive,
  container,
}: TestLocalWebcamSourceOptions): Promise<SourceTestResult> {
  const blockMessage = getLocalWebcamBlockMessage();
  if (blockMessage) return { state: "error", message: blockMessage };

  const activeVideo = container?.querySelector("video[data-live-media='primary']") as HTMLVideoElement | null;
  if (isActive && activeVideo?.srcObject && activeVideo.videoWidth > 0) {
    return { state: "active", message: "Source valid: webcam lokal sedang aktif." };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      audio: false,
    });
    const activeTrack = stream.getVideoTracks()[0];
    stream.getTracks().forEach((track) => track.stop());

    return {
      state: "active",
      message: activeTrack?.label
        ? `Source valid: webcam lokal bisa diakses (${activeTrack.label}).`
        : "Source valid: webcam lokal bisa diakses.",
    };
  } catch (error) {
    return getWebcamTestResult(error);
  }
}

async function testRemoteCameraSource({
  sourceType,
  streamUrl,
}: TestRemoteCameraSourceOptions): Promise<SourceTestResult> {
  if (sourceType === "mock") {
    return { state: "active", message: "Source valid: preview mock siap digunakan." };
  }

  const input = streamUrl.trim();
  if (sourceType === "rtsp" && input && !looksLikeUrl(input) && normalizeMediaPath(input)) {
    return {
      state: "unsupported",
      message: `"${input}" adalah media path MediaMTX. Pilih HLS / MediaMTX untuk path ini; RTSP hanya untuk URL rtsp:// dari CCTV/NVR.`,
    };
  }

  if (sourceType === "rtsp" || sourceType === "nvr" || sourceType === "webrtc") {
    return {
      state: "unsupported",
      message: getUnsupportedSourceTestMessage(sourceType),
    };
  }

  if (!input) {
    return { state: "missing", message: sourceType === "hls" ? "Masukkan media path atau URL HLS dulu." : "Masukkan URL stream kamera dulu." };
  }

  const urlResult = normalizeHttpUrl(input);
  if (!urlResult.ok) return urlResult.result;

  const url = urlResult.url;
  const mixedContentResult = getMixedContentResult(url);
  if (mixedContentResult) return mixedContentResult;

  const sourceKind = getRemoteSourceKind(sourceType, url.href);

  if (sourceKind === "hls") {
    return testHlsSource(url.href);
  }

  if (sourceKind === "video") {
    return testVideoSource(url.href);
  }

  return testImageSource(url.href);
}
async function testHlsSource(streamUrl: string): Promise<SourceTestResult> {
  const corsResult = await probeCors(streamUrl);
  if (corsResult.ok) {
    const contentType = corsResult.contentType.toLowerCase();
    const looksLikeHls = streamUrl.toLowerCase().includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("vnd.apple") || contentType.includes("text/plain") || contentType.includes("application/octet-stream");

    return {
      state: looksLikeHls ? "active" : "unsupported",
      message: looksLikeHls
        ? "Source valid: manifest HLS bisa diakses."
        : `Format belum support: response bukan manifest HLS (${corsResult.contentType || "content-type kosong"}).`,
    };
  }

  if (corsResult.status === 404) {
    return {
      state: "starting",
      message: "Stream belum aktif. Buka Camera Station atau tab publisher, izinkan kamera, lalu klik Publish.",
    };
  }

  if (corsResult.status > 0) {
    return {
      state: "starting",
      message: `Manifest HLS belum siap (HTTP ${corsResult.status}). Pastikan publisher kamera sudah aktif di MediaMTX.`,
    };
  }

  const noCorsResult = await probeNoCors(streamUrl);
  if (noCorsResult.ok) {
    return {
      state: "error",
      message: "CORS blocked: URL HLS terjangkau, tapi server belum mengizinkan browser membaca manifest. Cek header CORS di proxy /hls atau MediaMTX.",
    };
  }

  return { state: "error", message: "URL HLS tidak bisa diakses atau server kamera tidak merespons." };
}
async function testVideoSource(streamUrl: string): Promise<SourceTestResult> {
  const mediaResult = await probeVideoElement(streamUrl);
  if (mediaResult.ok) return { state: "active", message: "Source valid: video bisa dimuat browser." };

  const corsResult = await probeCors(streamUrl);
  if (!corsResult.ok) {
    const noCorsResult = await probeNoCors(streamUrl);
    if (noCorsResult.ok) {
      return {
        state: "error",
        message: "CORS blocked: URL video terjangkau, tapi server tidak mengizinkan fetch. Playback mungkin bisa, tetapi validasi/snapshot bisa terbatas.",
      };
    }
  }

  return { state: "error", message: mediaResult.message || "URL tidak bisa diakses atau format video belum bisa diputar." };
}

async function testImageSource(streamUrl: string): Promise<SourceTestResult> {
  const imageResult = await probeImageElement(streamUrl);
  if (imageResult.ok) {
    const corsResult = await probeCors(streamUrl);
    if (!corsResult.ok) {
      const noCorsResult = await probeNoCors(streamUrl);
      if (noCorsResult.ok) {
        return {
          state: "active",
          message: "Source valid: image/MJPEG bisa tampil. Catatan: CORS blocked, snapshot/fetch bisa terbatas.",
        };
      }
    }

    return { state: "active", message: "Source valid: image/MJPEG bisa dimuat browser." };
  }

  const noCorsResult = await probeNoCors(streamUrl);
  if (noCorsResult.ok) {
    return {
      state: "error",
      message: "CORS blocked atau format image/MJPEG tidak dikenali browser. URL terjangkau, tapi preview belum bisa dipastikan.",
    };
  }

  return { state: "error", message: imageResult.message || "URL tidak bisa diakses atau kamera HP tidak merespons." };
}

async function probeCors(streamUrl: string): Promise<{ ok: boolean; status: number; contentType: string }> {
  try {
    const response = await fetchWithTimeout(streamUrl, { mode: "cors", cache: "no-store" }, 5000);
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch {
    return { ok: false, status: 0, contentType: "" };
  }
}
async function probeNoCors(streamUrl: string): Promise<{ ok: boolean }> {
  try {
    await fetchWithTimeout(streamUrl, { mode: "no-cors", cache: "no-store" }, 5000);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function probeImageElement(streamUrl: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.src = "";
      resolve({ ok: false, message: "URL image/MJPEG timeout. Kamera mungkin offline atau format tidak support." });
    }, 7000);

    image.onload = () => {
      window.clearTimeout(timeout);
      resolve({ ok: true });
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      resolve({ ok: false, message: "Image/MJPEG gagal dimuat. Cek URL, jaringan, atau format stream." });
    };
    image.src = appendCacheBuster(streamUrl);
  });
}

function probeVideoElement(streamUrl: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const timeout = window.setTimeout(() => {
      video.removeAttribute("src");
      video.load();
      resolve({ ok: false, message: "Video timeout. Kamera mungkin offline, CORS blocked, atau format tidak support." });
    }, 8000);

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      resolve({ ok: true });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      video.removeAttribute("src");
      video.load();
      resolve({ ok: false, message: "Video gagal dimuat. Format belum support atau URL tidak bisa diakses." });
    };
    video.src = appendCacheBuster(streamUrl);
    video.load();
  });
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeHttpUrl(streamUrl: string): { ok: true; url: URL } | { ok: false; result: SourceTestResult } {
  try {
    const url = new URL(streamUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        ok: false,
        result: { state: "unsupported", message: "Format belum support: browser hanya bisa test URL HTTP/HTTPS. RTSP/NVR perlu gateway." },
      };
    }

    return { ok: true, url };
  } catch {
    return { ok: false, result: { state: "error", message: "URL tidak valid. Gunakan format seperti http://IP-HP:PORT/video." } };
  }
}

function getMixedContentResult(url: URL): SourceTestResult | null {
  if (typeof window === "undefined") return null;
  if (window.location.protocol !== "https:" || url.protocol !== "http:") return null;

  const isLocalTarget = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (isLocalTarget) return null;

  return {
    state: "error",
    message: "URL tidak bisa diakses dari halaman HTTPS karena mixed content HTTP. Pakai HTTPS/tunnel, atau buka dashboard via HTTP lokal.",
  };
}

function getRemoteSourceKind(sourceType: CameraSourceType, streamUrl: string) {
  const lowerUrl = streamUrl.toLowerCase();
  if (sourceType === "hls" || lowerUrl.includes(".m3u8")) return "hls";
  if (sourceType === "direct-video" || /\.(mp4|webm|ogg)(\?|#|$)/i.test(lowerUrl)) return "video";
  return "image";
}

function appendCacheBuster(streamUrl: string) {
  const separator = streamUrl.includes("?") ? "&" : "?";
  return `${streamUrl}${separator}_brave_test=${Date.now()}`;
}

function getWebcamTestResult(error: unknown): SourceTestResult {
  if (!(error instanceof DOMException)) {
    return { state: "error", message: "Webcam lokal belum bisa diakses." };
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return { state: "permission-denied", message: "Izin kamera ditolak. Izinkan akses kamera di browser lalu test ulang." };
  }

  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return { state: "busy", message: "Kamera sedang dipakai aplikasi lain atau driver belum siap." };
  }

  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return { state: "missing", message: "Tidak ada kamera lokal terdeteksi." };
  }

  if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
    return { state: "missing", message: "Kamera yang dipilih tidak tersedia. Pilih default atau refresh daftar kamera." };
  }

  return { state: "error", message: error.message || "Webcam lokal belum bisa diakses." };
}

function getSourceTestErrorResult(error: unknown): SourceTestResult {
  return {
    state: "error",
    message: error instanceof Error ? error.message : "Test source gagal dijalankan.",
  };
}

function getCameraSourceInputValue(camera: CameraType | undefined) {
  if (!camera) return "";
  if (camera.sourceType === "hls") return camera.mediaPath ?? camera.streamUrl ?? "";
  return camera.streamUrl ?? "";
}

function buildCameraSourceUpdate(sourceType: CameraSourceType, rawInput: string) {
  const input = rawInput.trim();
  if (sourceType !== "hls") {
    return { sourceType, streamUrl: input || null, mediaPath: null };
  }

  if (!input) return { sourceType, streamUrl: null, mediaPath: null };
  if (looksLikeUrl(input)) {
    return { sourceType, streamUrl: input, mediaPath: extractMediaPathFromHlsUrl(input) };
  }

  return { sourceType, streamUrl: null, mediaPath: normalizeMediaPath(input) };
}

function resolveCameraSourceTestUrl(sourceType: CameraSourceType, rawInput: string) {
  const input = rawInput.trim();
  if (sourceType !== "hls" || !input || looksLikeUrl(input)) return input;
  return buildGatewayHlsUrl(normalizeMediaPath(input));
}

function getSourceInputPlaceholder(sourceType: CameraSourceType) {
  if (sourceType === "local-webcam") return "Webcam lokal tidak memerlukan URL";
  if (sourceType === "hls") return "browser-cam-65c7f atau https://brave-ai.web.id/hls/browser-cam-65c7f/index.m3u8";
  return "URL stream kamera...";
}

function looksLikeUrl(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}
async function copyTextToClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}
function getUnsupportedSourceTestMessage(sourceType: CameraSourceType) {
  if (sourceType === "rtsp") return "Format belum support di browser: RTSP perlu media gateway ke HLS/WebRTC.";
  if (sourceType === "nvr") return "Format belum support langsung: NVR/DVR perlu gateway atau API playback.";
  if (sourceType === "webrtc") return "Format belum support untuk test lokal: WebRTC perlu signaling server.";
  return "Format belum support di browser.";
}
function getLocalWebcamBlockMessage() {
  if (typeof window === "undefined") return "";

  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const isHttps = window.location.protocol === "https:";

  if (!window.isSecureContext && !isLocalHost) {
    if (isHttps) {
      return "HTTPS belum dipercaya browser. Trust sertifikat dev atau pakai tunnel HTTPS agar kamera HP bisa aktif.";
    }

    return "Akses kamera HP/PWA perlu HTTPS. Jalankan npm run dev:https lalu buka https://IP-LAPTOP:3000.";
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return "Browser belum mendukung akses webcam lokal.";
  }

  return "";
}
function getSourceLabel(sourceType: CameraSourceType | undefined) {
  const labels: Record<CameraSourceType, string> = {
    mock: "Preview Mock",
    "local-webcam": "Webcam Lokal",
    "phone-webcam": "Kamera HP",
    hls: "HLS / MediaMTX",
    "direct-video": "MP4/WebM",
    webrtc: "WebRTC",
    rtsp: "RTSP",
    nvr: "NVR/DVR",
  };
  return labels[sourceType ?? "mock"];
}

function getSourceSaveMessage(sourceType: CameraSourceType) {
  if (sourceType === "rtsp") return "Sumber RTSP tersimpan. Playback browser perlu media gateway ke HLS atau WebRTC.";
  if (sourceType === "nvr") return "Sumber NVR/DVR tersimpan. Playback real perlu gateway NVR/media service.";
  if (sourceType === "webrtc") return "Sumber WebRTC tersimpan. Playback real perlu signaling server.";
  if (sourceType === "hls") return "Sumber HLS/MediaMTX tersimpan. Jika preview belum muncul, aktifkan publisher dari Camera Station.";
  if (sourceType === "mock") return "Sumber dikembalikan ke preview mock.";
  return "Sumber kamera tersimpan.";
}

function getSavedSourceStatusState(sourceType: CameraSourceType): LiveCameraPlayerStatus["state"] {
  if (sourceType === "mock") return "preview";
  if (sourceType === "rtsp" || sourceType === "nvr" || sourceType === "webrtc") return "unsupported";
  if (sourceType === "hls") return "starting";
  return "active";
}

function getSourceStatusContainerClass(state: LiveCameraPlayerStatus["state"]) {
  if (state === "active") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (state === "starting") return "border-amber-100 bg-amber-50 text-amber-700";
  if (["permission-denied", "busy", "missing", "unsupported", "offline", "error", "stopped"].includes(state)) {
    return "border-red-100 bg-red-50 text-red-600";
  }
  return "border-slate-100 bg-white text-slate-500";
}

function getSourceStatusDotClass(state: LiveCameraPlayerStatus["state"]) {
  if (state === "active") return "bg-emerald-500";
  if (state === "starting") return "bg-amber-400 animate-pulse";
  if (["permission-denied", "busy", "missing", "unsupported", "offline", "error", "stopped"].includes(state)) return "bg-red-500";
  return "bg-slate-300";
}
