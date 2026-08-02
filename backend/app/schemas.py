from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

UserRole = Literal["admin", "viewer"]
CameraStatus = Literal["online", "offline", "recording"]
CameraConnectionState = Literal["live", "waiting", "unavailable"]
CameraSourceType = Literal[
    "mock",
    "local-webcam",
    "phone-webcam",
    "hls",
    "direct-video",
    "webrtc",
    "rtsp",
    "nvr",
]
AlertType = Literal["bullying_detected", "camera_offline", "camera_online", "system"]
AlertPriority = Literal["low", "medium", "high", "critical"]
BullySeverity = Literal["low", "medium", "high", "critical"]
BullyType = Literal["physical"]
LogStatus = Literal["dalam-proses", "selesai", "ditinjau", "prioritas-tinggi"]
IncidentVerification = Literal["pending", "bullying", "not-bullying"]
ReportStatus = Literal["draft", "ditindaklanjuti", "selesai"]
TimelineStatus = Literal["completed", "current", "pending"]
RecordingStatus = Literal["tersimpan", "ditinjau", "terkunci"]
StorageStatus = Literal["available", "unavailable"]


class User(BaseModel):
    id: str
    name: str
    email: str
    role: UserRole
    avatar: str | None = None


class LoginCredentials(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    user: User


class Camera(BaseModel):
    id: str
    name: str
    location: str
    status: CameraStatus
    stream_url: str | None = Field(default=None, alias="streamUrl")
    media_path: str | None = Field(default=None, alias="mediaPath")
    live_hls_url: str | None = Field(default=None, alias="liveHlsUrl")
    source_type: CameraSourceType = Field(default="mock", alias="sourceType")
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")
    last_active: datetime = Field(alias="lastActive")
    is_ai_enabled: bool = Field(alias="isAiEnabled")

    model_config = {"populate_by_name": True}


class CameraCreate(BaseModel):
    name: str
    location: str
    is_ai_enabled: bool = Field(default=True, alias="isAiEnabled")
    source_type: CameraSourceType = Field(default="mock", alias="sourceType")

    model_config = {"populate_by_name": True}


class CameraRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    location: str | None = Field(default=None, max_length=180)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Nama kamera tidak boleh kosong")
        return normalized

    @field_validator("location")
    @classmethod
    def normalize_location(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Lokasi kamera tidak boleh kosong")
        return normalized


class CameraConnectionStatus(BaseModel):
    camera_id: str = Field(alias="cameraId")
    media_path: str | None = Field(default=None, alias="mediaPath")
    connected: bool
    status: CameraConnectionState
    message: str
    checked_at: datetime = Field(alias="checkedAt")

    model_config = {"populate_by_name": True}


class CameraSourceUpdate(BaseModel):
    source_type: CameraSourceType = Field(alias="sourceType")
    stream_url: str | None = Field(default=None, alias="streamUrl")
    media_path: str | None = Field(default=None, alias="mediaPath")
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")

    model_config = {"populate_by_name": True}


class Recording(BaseModel):
    id: str
    camera_id: str = Field(alias="cameraId")
    camera_name: str = Field(alias="cameraName")
    location: str
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    duration: int
    file_url: str | None = Field(default=None, alias="fileUrl")
    file_size: int = Field(alias="fileSize")
    has_incident: bool = Field(alias="hasIncident")
    incident_count: int = Field(alias="incidentCount")
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")
    status: RecordingStatus
    storage_status: StorageStatus = Field(alias="storageStatus")
    playback_url: str | None = Field(default=None, alias="playbackUrl")
    available_at: datetime | None = Field(default=None, alias="availableAt")
    expires_at: datetime | None = Field(default=None, alias="expiresAt")

    model_config = {"populate_by_name": True}


class RecordingSegment(BaseModel):
    id: str
    camera_id: str = Field(alias="cameraId")
    media_path: str = Field(alias="mediaPath")
    file_path: str = Field(alias="filePath")
    media_url: str | None = Field(default=None, alias="mediaUrl")
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    duration: int
    file_size: int = Field(alias="fileSize")

    model_config = {"populate_by_name": True}


class EvidenceClipRequest(BaseModel):
    camera_id: str = Field(alias="cameraId")
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    reason: str = "manual_save"

    model_config = {"populate_by_name": True}


class EvidenceClipResponse(BaseModel):
    id: str
    recording_id: str = Field(alias="recordingId")
    camera_id: str = Field(alias="cameraId")
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    reason: str
    clip_url: str = Field(alias="clipUrl")
    status: Literal["queued", "processing", "ready", "failed"]
    created_at: datetime = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class TimelineEvent(BaseModel):
    title: str
    description: str
    timestamp: datetime
    status: TimelineStatus


class BullyingLog(BaseModel):
    id: str
    camera_id: str = Field(alias="cameraId")
    camera_name: str = Field(alias="cameraName")
    camera_location: str = Field(default="-", alias="cameraLocation")
    recording_id: str | None = Field(default=None, alias="recordingId")
    report_id: str | None = Field(default=None, alias="reportId")
    title: str
    timestamp: datetime
    severity: BullySeverity
    bully_type: BullyType = Field(alias="bullyType")
    description: str
    confidence: float = Field(ge=0.0, le=1.0)
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")
    status: LogStatus
    verification_status: IncidentVerification = Field(
        default="pending",
        alias="verificationStatus",
    )
    verified_by: str | None = Field(default=None, alias="verifiedBy")
    verified_at: datetime | None = Field(default=None, alias="verifiedAt")
    pelapor: str
    terkait_rekaman: str = Field(alias="terkaitRekaman")
    timeline: list[TimelineEvent]

    model_config = {"populate_by_name": True}


class BullyingLogStatusUpdate(BaseModel):
    status: LogStatus


class BullyingLogVerificationUpdate(BaseModel):
    verification: Literal["bullying", "not-bullying"]


class IncidentReport(BaseModel):
    id: str
    log_id: str = Field(alias="logId")
    camera_id: str = Field(alias="cameraId")
    camera_name: str = Field(alias="cameraName")
    camera_location: str = Field(alias="cameraLocation")
    incident_at: datetime = Field(alias="incidentAt")
    confidence: float = Field(ge=0.0, le=1.0)
    ai_reason: str = Field(alias="aiReason")
    recording_id: str | None = Field(default=None, alias="recordingId")
    title: str
    chronology: str
    handling_notes: str = Field(alias="handlingNotes")
    status: ReportStatus
    created_by: str = Field(alias="createdBy")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class IncidentReportUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    chronology: str | None = Field(default=None, max_length=5000)
    handling_notes: str | None = Field(
        default=None,
        alias="handlingNotes",
        max_length=5000,
    )
    status: ReportStatus | None = None

    model_config = {"populate_by_name": True}

    @field_validator("title")
    @classmethod
    def normalize_report_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Judul laporan tidak boleh kosong")
        return normalized


class Alert(BaseModel):
    id: str
    type: AlertType
    priority: AlertPriority
    camera_id: str | None = Field(default=None, alias="cameraId")
    camera_name: str | None = Field(default=None, alias="cameraName")
    title: str
    message: str
    timestamp: datetime
    is_read: bool = Field(default=False, alias="isRead")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class MarkReadRequest(BaseModel):
    alert_id: str = Field(alias="alertId")

    model_config = {"populate_by_name": True}


class IncidentEventCreate(BaseModel):
    event_id: str | None = Field(
        default=None,
        alias="eventId",
        min_length=8,
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    )
    camera_id: str = Field(alias="cameraId")
    camera_name: str = Field(alias="cameraName")
    bully_type: BullyType = Field(alias="bullyType")
    severity: BullySeverity
    confidence: float = Field(ge=0.0, le=1.0)
    description: str
    occurred_at: datetime | None = Field(default=None, alias="occurredAt")
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")
    recording_id: str | None = Field(default=None, alias="recordingId")

    model_config = {"populate_by_name": True}


class IncidentEventResult(BaseModel):
    log: BullyingLog
    alert: Alert
