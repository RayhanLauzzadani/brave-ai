from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.schemas import (
    Alert,
    BullyingLog,
    Camera,
    CameraSourceUpdate,
    EvidenceClipRequest,
    EvidenceClipResponse,
    IncidentEventCreate,
    IncidentEventResult,
    Recording,
    TimelineEvent,
)

now = datetime.now(UTC)

cameras: list[Camera] = [
    Camera(
        id="cam-001",
        name="Koridor Lantai 2",
        location="Gedung A Lt. 2",
        status="recording",
        streamUrl=None,
        sourceType="mock",
        thumbnailUrl="/images/cam-placeholder.svg",
        lastActive=now,
        isAiEnabled=True,
    ),
    Camera(
        id="cam-002",
        name="Halaman Depan",
        location="Gedung A Lt. 1",
        status="online",
        streamUrl=None,
        sourceType="mock",
        thumbnailUrl="/images/cam-placeholder.svg",
        lastActive=now - timedelta(minutes=3),
        isAiEnabled=True,
    ),
    Camera(
        id="cam-003",
        name="Kantin Sekolah",
        location="Gedung B Lt. 1",
        status="online",
        streamUrl=None,
        sourceType="mock",
        thumbnailUrl="/images/cam-placeholder.svg",
        lastActive=now - timedelta(minutes=5),
        isAiEnabled=True,
    ),
    Camera(
        id="cam-004",
        name="Kelas IX B",
        location="Gedung C Lt. 2",
        status="offline",
        streamUrl=None,
        thumbnailUrl="/images/cam-placeholder.svg",
        lastActive=now - timedelta(hours=2),
        isAiEnabled=False,
    ),
]

recordings: list[Recording] = [
    Recording(
        id="rec-001",
        cameraId="cam-001",
        cameraName="Koridor Lantai 2",
        location="Gedung A Lt. 2",
        startTime=now - timedelta(hours=6),
        endTime=now,
        duration=21600,
        fileUrl=None,
        fileSize=1_800_000_000,
        hasIncident=True,
        incidentCount=2,
        thumbnailUrl="https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=900&auto=format&fit=crop",
        status="ditinjau",
        storageStatus="available",
        playbackUrl="/media/playback/rec-001/index.m3u8",
    ),
    Recording(
        id="rec-002",
        cameraId="cam-002",
        cameraName="Halaman Depan",
        location="Gedung A Lt. 1",
        startTime=now - timedelta(days=1, hours=4),
        endTime=now - timedelta(days=1),
        duration=14400,
        fileUrl=None,
        fileSize=1_200_000_000,
        hasIncident=True,
        incidentCount=1,
        thumbnailUrl="https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=900&auto=format&fit=crop",
        status="tersimpan",
        storageStatus="available",
        playbackUrl="/media/playback/rec-002/index.m3u8",
    ),
    Recording(
        id="rec-003",
        cameraId="cam-003",
        cameraName="Kantin Sekolah",
        location="Gedung B Lt. 1",
        startTime=now - timedelta(days=2, hours=3),
        endTime=now - timedelta(days=2),
        duration=10800,
        fileUrl=None,
        fileSize=980_000_000,
        hasIncident=False,
        incidentCount=0,
        thumbnailUrl="https://images.unsplash.com/photo-1590402494682-cd3fb53b1f70?q=80&w=900&auto=format&fit=crop",
        status="tersimpan",
        storageStatus="available",
        playbackUrl="/media/playback/rec-003/index.m3u8",
    ),
    Recording(
        id="rec-004",
        cameraId="cam-004",
        cameraName="Kelas IX B",
        location="Gedung C Lt. 2",
        startTime=now - timedelta(days=3, hours=2),
        endTime=now - timedelta(days=3),
        duration=7200,
        fileUrl=None,
        fileSize=0,
        hasIncident=True,
        incidentCount=1,
        thumbnailUrl="https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=900&auto=format&fit=crop",
        status="tersimpan",
        storageStatus="unavailable",
        playbackUrl=None,
    ),
    Recording(
        id="rec-005",
        cameraId="cam-001",
        cameraName="Koridor Lantai 2",
        location="Gedung A Lt. 2",
        startTime=now - timedelta(days=4, hours=5),
        endTime=now - timedelta(days=4),
        duration=18000,
        fileUrl=None,
        fileSize=1_500_000_000,
        hasIncident=False,
        incidentCount=0,
        thumbnailUrl="https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=900&auto=format&fit=crop",
        status="terkunci",
        storageStatus="available",
        playbackUrl="/media/playback/rec-005/index.m3u8",
    ),
    Recording(
        id="rec-006",
        cameraId="cam-003",
        cameraName="Kantin Sekolah",
        location="Gedung B Lt. 1",
        startTime=now - timedelta(days=6, hours=1),
        endTime=now - timedelta(days=6),
        duration=3600,
        fileUrl=None,
        fileSize=420_000_000,
        hasIncident=True,
        incidentCount=1,
        thumbnailUrl="https://images.unsplash.com/photo-1590402494682-cd3fb53b1f70?q=80&w=900&auto=format&fit=crop",
        status="ditinjau",
        storageStatus="available",
        playbackUrl="/media/playback/rec-006/index.m3u8",
    ),
]
bullying_logs: list[BullyingLog] = [
    BullyingLog(
        id="log-001",
        cameraId="cam-001",
        cameraName="Koridor Lantai 2",
        recordingId="rec-001",
        title="Indikasi verbal bullying",
        timestamp=now - timedelta(minutes=35),
        severity="medium",
        bullyType="verbal",
        description=(
            "Terdeteksi kata-kata kasar dan gestur intimidatif di area koridor."
        ),
        confidence=0.87,
        thumbnailUrl="https://images.unsplash.com/photo-1509062522246-3755977927d7?q=80&w=900&auto=format&fit=crop",
        status="dalam-proses",
        pelapor="Sistem Deteksi Eksternal",
        terkaitRekaman="Koridor Lantai 2 / rec-001",
        timeline=[
            TimelineEvent(
                title="Laporan otomatis dibuat",
                description="oleh service deteksi eksternal",
                timestamp=now - timedelta(minutes=35),
                status="completed",
            ),
            TimelineEvent(
                title="Menunggu tindak lanjut",
                description="Pengawas perlu meninjau bukti rekaman",
                timestamp=now - timedelta(minutes=34),
                status="current",
            ),
        ],
    ),
    BullyingLog(
        id="log-002",
        cameraId="cam-002",
        cameraName="Halaman Depan",
        recordingId="rec-002",
        title="Intimidasi verbal di halaman depan",
        timestamp=now - timedelta(days=1, hours=2),
        severity="high",
        bullyType="verbal",
        description="Kelompok siswa memojokkan satu siswa baru dan terindikasi ancaman verbal.",
        confidence=0.88,
        thumbnailUrl="https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=900&auto=format&fit=crop",
        status="ditinjau",
        pelapor="Admin Sekolah",
        terkaitRekaman="Halaman Depan / rec-002",
        timeline=[
            TimelineEvent(
                title="Laporan dibuat",
                description="oleh Admin Sekolah",
                timestamp=now - timedelta(days=1, hours=2),
                status="completed",
            ),
            TimelineEvent(
                title="Bukti sedang ditinjau",
                description="oleh guru piket",
                timestamp=now - timedelta(days=1, hours=1, minutes=40),
                status="current",
            ),
        ],
    ),
    BullyingLog(
        id="log-003",
        cameraId="cam-003",
        cameraName="Kantin Sekolah",
        recordingId="rec-003",
        title="Dorongan antar siswa saat antrean",
        timestamp=now - timedelta(days=2, hours=1),
        severity="low",
        bullyType="physical",
        description="Terjadi insiden saling dorong di area kantin karena masalah antrean.",
        confidence=0.72,
        thumbnailUrl="https://images.unsplash.com/photo-1590402494682-cd3fb53b1f70?q=80&w=900&auto=format&fit=crop",
        status="selesai",
        pelapor="Petugas Kantin",
        terkaitRekaman="Kantin Sekolah / rec-003",
        timeline=[
            TimelineEvent(
                title="Laporan dibuat",
                description="oleh Petugas Kantin",
                timestamp=now - timedelta(days=2, hours=1),
                status="completed",
            ),
            TimelineEvent(
                title="Selesai ditangani",
                description="oleh Guru Piket",
                timestamp=now - timedelta(days=2, minutes=30),
                status="completed",
            ),
        ],
    ),
    BullyingLog(
        id="log-004",
        cameraId="cam-004",
        cameraName="Kelas IX B",
        recordingId="rec-004",
        title="Kerumunan dan indikasi pengucilan",
        timestamp=now - timedelta(days=3, hours=1),
        severity="critical",
        bullyType="social",
        description="Terekam beberapa siswa mengisolasi satu siswa di sudut kelas. Rekaman NVR tidak tersedia penuh.",
        confidence=0.91,
        thumbnailUrl="https://images.unsplash.com/photo-1580582932707-520aed937b7b?q=80&w=900&auto=format&fit=crop",
        status="prioritas-tinggi",
        pelapor="Sistem Deteksi Eksternal",
        terkaitRekaman="Kelas IX B / rec-004",
        timeline=[
            TimelineEvent(
                title="Laporan prioritas dibuat",
                description="oleh service deteksi eksternal",
                timestamp=now - timedelta(days=3, hours=1),
                status="completed",
            ),
            TimelineEvent(
                title="Menunggu penanganan darurat",
                description="Eskalasi ke wali kelas dan guru BK",
                timestamp=now - timedelta(days=3, minutes=50),
                status="current",
            ),
        ],
    ),
    BullyingLog(
        id="log-005",
        cameraId="cam-003",
        cameraName="Kantin Sekolah",
        recordingId="rec-006",
        title="Pengambilan barang tanpa izin",
        timestamp=now - timedelta(days=6, minutes=35),
        severity="medium",
        bullyType="physical",
        description="Tas siswa diambil paksa oleh siswa lain dan memerlukan tindak lanjut wali kelas.",
        confidence=0.83,
        thumbnailUrl="https://images.unsplash.com/photo-1590402494682-cd3fb53b1f70?q=80&w=900&auto=format&fit=crop",
        status="dalam-proses",
        pelapor="Guru Piket",
        terkaitRekaman="Kantin Sekolah / rec-006",
        timeline=[
            TimelineEvent(
                title="Laporan dibuat",
                description="oleh Guru Piket",
                timestamp=now - timedelta(days=6, minutes=35),
                status="completed",
            ),
            TimelineEvent(
                title="Menunggu klarifikasi",
                description="Siswa terkait belum dipanggil",
                timestamp=now - timedelta(days=6, minutes=25),
                status="current",
            ),
        ],
    ),
]
alerts: list[Alert] = [
    Alert(
        id="alert-001",
        type="bullying_detected",
        priority="high",
        cameraId="cam-001",
        cameraName="Koridor Lantai 2",
        title="Indikasi Bullying Terdeteksi",
        message="Sistem menerima indikasi verbal bullying. Confidence: 87%",
        timestamp=now - timedelta(minutes=35),
        isRead=False,
        metadata={"confidence": 0.87, "logId": "log-001", "recordingId": "rec-001"},
    )
]

def list_cameras() -> list[Camera]:
    return cameras


def get_camera(camera_id: str) -> Camera | None:
    return next((camera for camera in cameras if camera.id == camera_id), None)




def update_camera_source(
    camera_id: str,
    payload: CameraSourceUpdate,
) -> Camera | None:
    for index, camera in enumerate(cameras):
        if camera.id == camera_id:
            stream_url = payload.stream_url.strip() if payload.stream_url else None
            thumbnail_url = payload.thumbnail_url or camera.thumbnail_url
            status = camera.status
            if payload.source_type == "mock":
                status = "online" if camera.status != "offline" else camera.status
            elif payload.source_type in {"hls", "direct-video", "phone-webcam"} and stream_url:
                status = "online"
            elif payload.source_type in {"rtsp", "nvr", "webrtc"} and stream_url:
                status = "online"

            updated = camera.model_copy(
                update={
                    "stream_url": stream_url,
                    "source_type": payload.source_type,
                    "thumbnail_url": thumbnail_url,
                    "status": status,
                    "last_active": datetime.now(UTC),
                }
            )
            cameras[index] = updated
            return updated
    return None

def list_recordings(
    camera_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    has_incident: bool | None = None,
    recording_status: str | None = None,
    search: str | None = None,
) -> list[Recording]:
    result = recordings
    if camera_id:
        result = [recording for recording in result if recording.camera_id == camera_id]
    if date_from:
        date_from = _ensure_aware(date_from)
        result = [recording for recording in result if recording.end_time >= date_from]
    if date_to:
        date_to = _ensure_aware(date_to)
        result = [recording for recording in result if recording.start_time <= date_to]
    if has_incident is not None:
        result = [
            recording for recording in result if recording.has_incident == has_incident
        ]
    if recording_status and recording_status != "all":
        result = [recording for recording in result if recording.status == recording_status]
    if search:
        query = search.lower().strip()
        result = [
            recording
            for recording in result
            if query in recording.id.lower()
            or query in recording.camera_name.lower()
            or query in recording.location.lower()
            or query in recording.start_time.strftime("%d %b %Y %H:%M").lower()
        ]
    return sorted(result, key=lambda item: item.start_time, reverse=True)


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def get_recording(recording_id: str) -> Recording | None:
    return next((recording for recording in recordings if recording.id == recording_id), None)


def queue_evidence_clip(
    recording_id: str, request: EvidenceClipRequest
) -> EvidenceClipResponse:
    return EvidenceClipResponse(
        id=f"clip-{uuid4().hex[:8]}",
        recordingId=recording_id,
        clipUrl=f"/media/clips/{recording_id}-{uuid4().hex[:6]}.mp4",
        status="queued",
    )


def list_bullying_logs(
    camera_id: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    bully_type: str | None = None,
    recording_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
) -> list[BullyingLog]:
    result = bullying_logs
    if camera_id:
        result = [log for log in result if log.camera_id == camera_id]
    if severity:
        result = [log for log in result if log.severity == severity]
    if status and status != "all":
        result = [log for log in result if log.status == status]
    if bully_type and bully_type != "all":
        result = [log for log in result if log.bully_type == bully_type]
    if recording_id:
        result = [log for log in result if log.recording_id == recording_id]
    if date_from:
        date_from = _ensure_aware(date_from)
        result = [log for log in result if log.timestamp >= date_from]
    if date_to:
        date_to = _ensure_aware(date_to)
        result = [log for log in result if log.timestamp <= date_to]
    if search:
        query = search.lower().strip()

        def matches_search(log: BullyingLog) -> bool:
            camera = get_camera(log.camera_id)
            recording = get_recording(log.recording_id) if log.recording_id else None
            values = [
                log.id,
                log.title,
                log.camera_name,
                log.description,
                log.terkait_rekaman,
                log.timestamp.strftime("%d %b %Y %H:%M"),
                camera.location if camera else "",
                recording.id if recording else "",
                recording.location if recording else "",
            ]
            return any(query in value.lower() for value in values if value)

        result = [log for log in result if matches_search(log)]
    return sorted(result, key=lambda item: item.timestamp, reverse=True)


def get_bullying_log(log_id: str) -> BullyingLog | None:
    return next((log for log in bullying_logs if log.id == log_id), None)


def update_bullying_log_status(log_id: str, status: str) -> BullyingLog | None:
    for index, log in enumerate(bullying_logs):
        if log.id == log_id:
            status_titles = {
                "dalam-proses": "Status dikembalikan ke proses",
                "ditinjau": "Bukti sedang ditinjau",
                "selesai": "Laporan selesai ditangani",
                "prioritas-tinggi": "Laporan diprioritaskan",
            }
            updated_timeline = [
                *log.timeline,
                TimelineEvent(
                    title=status_titles.get(status, "Status diperbarui"),
                    description="oleh pengawas melalui halaman laporan",
                    timestamp=datetime.now(UTC),
                    status="completed" if status == "selesai" else "current",
                ),
            ]
            updated = log.model_copy(update={"status": status, "timeline": updated_timeline})
            bullying_logs[index] = updated
            return updated
    return None


def list_alerts(unread_only: bool = False) -> list[Alert]:
    result = alerts
    if unread_only:
        result = [alert for alert in result if not alert.is_read]
    return sorted(result, key=lambda item: item.timestamp, reverse=True)


def mark_alert_read(alert_id: str) -> Alert | None:
    for index, alert in enumerate(alerts):
        if alert.id == alert_id:
            updated = alert.model_copy(update={"is_read": True})
            alerts[index] = updated
            return updated
    return None


def mark_all_alerts_read() -> list[Alert]:
    for index, alert in enumerate(alerts):
        alerts[index] = alert.model_copy(update={"is_read": True})
    return list_alerts()


def create_incident_event(payload: IncidentEventCreate) -> IncidentEventResult:
    detected_at = payload.occurred_at or datetime.now(UTC)
    log_id = f"log-{uuid4().hex[:8]}"
    alert_id = f"alert-{uuid4().hex[:8]}"
    camera = get_camera(payload.camera_id)
    camera_name = camera.name if camera else payload.camera_name
    priority = "critical" if payload.severity == "critical" else "high"

    log = BullyingLog(
        id=log_id,
        cameraId=payload.camera_id,
        cameraName=camera_name,
        recordingId=payload.recording_id,
        title=f"Indikasi {payload.bully_type} bullying",
        timestamp=detected_at,
        severity=payload.severity,
        bullyType=payload.bully_type,
        description=payload.description,
        confidence=payload.confidence,
        thumbnailUrl=payload.thumbnail_url,
        status="prioritas-tinggi"
        if payload.severity in {"high", "critical"}
        else "dalam-proses",
        pelapor="Sistem Deteksi Eksternal",
        terkaitRekaman=f"{camera_name} / {payload.recording_id or 'rekaman berjalan'}",
        timeline=[
            TimelineEvent(
                title="Event diterima backend",
                description="dari service deteksi eksternal",
                timestamp=detected_at,
                status="completed",
            ),
            TimelineEvent(
                title="Menunggu penanganan",
                description="Pengawas perlu meninjau bukti dan menindaklanjuti",
                timestamp=detected_at,
                status="current",
            ),
        ],
    )

    alert = Alert(
        id=alert_id,
        type="bullying_detected",
        priority=priority,
        cameraId=payload.camera_id,
        cameraName=camera_name,
        title="Indikasi Bullying Diterima",
        message=(
            f"Backend menerima indikasi {payload.bully_type} bullying. "
            f"Confidence: {round(payload.confidence * 100)}%"
        ),
        timestamp=detected_at,
        isRead=False,
        metadata={"confidence": payload.confidence, "logId": log_id, "recordingId": payload.recording_id},
    )

    bullying_logs.insert(0, log)
    alerts.insert(0, alert)
    return IncidentEventResult(log=log, alert=alert)
