from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

UserRole = Literal["admin", "operator", "viewer"]
CameraStatus = Literal["online", "offline", "recording"]
CameraSourceType = Literal["mock", "local-webcam", "phone-webcam", "hls", "direct-video", "webrtc", "rtsp", "nvr"]
AlertType = Literal["bullying_detected", "camera_offline", "camera_online", "system"]
AlertPriority = Literal["low", "medium", "high", "critical"]
BullySeverity = Literal["low", "medium", "high", "critical"]
BullyType = Literal["physical", "verbal", "social", "unknown"]
LogStatus = Literal["dalam-proses", "selesai", "ditinjau", "prioritas-tinggi"]
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
    token: str


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
    recording_id: str | None = Field(default=None, alias="recordingId")
    title: str
    timestamp: datetime
    severity: BullySeverity
    bully_type: BullyType = Field(alias="bullyType")
    description: str
    confidence: float = Field(ge=0.0, le=1.0)
    thumbnail_url: str | None = Field(default=None, alias="thumbnailUrl")
    status: LogStatus
    pelapor: str
    terkait_rekaman: str = Field(alias="terkaitRekaman")
    timeline: list[TimelineEvent]

    model_config = {"populate_by_name": True}


class BullyingLogStatusUpdate(BaseModel):
    status: LogStatus


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
