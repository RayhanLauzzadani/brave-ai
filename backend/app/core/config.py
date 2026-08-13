from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BRAVE AI API"
    environment: str = "development"
    api_prefix: str = "/api"

    database_url: str = (
        "postgresql+asyncpg://brave:brave_password@localhost:5432/brave_ai"
    )
    redis_url: str = "redis://localhost:6379/0"

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.110.211:3000",
    ]
    media_base_url: str = "http://localhost:8000/media"
    media_hls_base_url: str = "http://localhost:8888"
    media_hls_probe_base_url: str = "http://localhost:8888"
    media_probe_timeout_seconds: float = 5.0
    media_recordings_dir: str = "/recordings"
    media_record_segment_duration_seconds: int = 60
    media_record_min_file_size_bytes: int = 65536
    media_archive_dir: str = "/archives"
    recording_session_duration_seconds: int = 24 * 60 * 60
    recording_archive_retention_days: int = 7
    recording_archive_poll_seconds: int = 60
    recording_archive_gap_tolerance_seconds: int = 10
    recording_archive_output_duration_tolerance_seconds: float = 10.0
    recording_archive_ffmpeg_timeout_seconds: int = 6 * 60 * 60
    recording_archive_video_crf: int = 30
    recording_archive_video_fps: int = 12
    recording_archive_video_preset: str = "veryfast"
    recording_archive_video_max_width: int = 960
    recording_archive_video_max_height: int = 540
    recording_archive_video_max_bitrate_kbps: int = 900
    recording_archive_audio_bitrate_kbps: int = 48
    media_clips_dir: str = "/clips"
    evidence_clip_max_duration_seconds: int = 600
    evidence_clip_ffmpeg_timeout_seconds: int = 180
    evidence_clip_source_wait_seconds: int = 120
    evidence_clip_gap_tolerance_seconds: float = 1.0
    evidence_clip_output_duration_tolerance_seconds: float = 2.0
    evidence_clip_retention_days: int = 7
    evidence_clip_cleanup_poll_seconds: int = 60 * 60
    ffprobe_binary: str = "ffprobe"
    ffprobe_timeout_seconds: float = 30.0
    ffmpeg_binary: str = "ffmpeg"
    # Centralized Gemini detection worker. Keep the key server-side only.
    gemini_api_key: str = ""
    gemini_model_name: str = "gemini-3.1-flash-lite"
    gemini_api_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_video_fps: float = 10.0
    gemini_inline_max_bytes: int = 18 * 1024 * 1024
    gemini_request_timeout_seconds: float = 45.0
    gemini_max_retries: int = 2
    ai_detection_enabled: bool = False
    ai_detection_clip_seconds: int = 3
    ai_detection_interval_seconds: float = 3.0
    ai_detection_confidence_threshold: float = 0.9
    ai_detection_cooldown_seconds: int = 30
    ai_detection_camera_refresh_seconds: int = 15
    ai_detection_queue_size: int = 2
    ai_detection_max_concurrency: int = 2
    ai_detection_max_clip_age_seconds: float = 30.0
    ai_detection_rtsp_base_url: str = "rtsp://mediamtx:8554"
    incident_api_base_url: str = "http://api:8000/api"
    incident_request_timeout_seconds: float = 10.0
    incident_request_max_attempts: int = 4
    incident_request_retry_base_seconds: float = 0.5
    ai_detection_capture_timeout_seconds: float = 20.0
    incident_ingest_token: str = ""
    # Offline Gemini dataset evaluation. This runner is intentionally separate
    # from the production detection worker and does not touch the database.
    ai_evaluation_dataset_dir: str = "datasets/brave-ai"
    ai_evaluation_report_dir: str = "docs/ai-evaluation"
    ai_evaluation_annotations_file: str = ""
    ai_evaluation_concurrency: int = 1
    ai_evaluation_threshold: float = 0.75
    secret_key: str = "change-this-development-key"
    access_token_expire_minutes: int = 1440
    session_cookie_name: str = "brave_session"
    seed_admin_email: str = "admin@braveai.school"
    seed_admin_password: str = "password"
    seed_viewer_email: str = "gurubk@braveai.school"
    seed_viewer_password: str = "password"

    @property
    def session_cookie_secure(self) -> bool:
        return self.environment.strip().lower() == "production"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
