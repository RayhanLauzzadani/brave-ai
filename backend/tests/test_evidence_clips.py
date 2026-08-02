import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.schemas import EvidenceClipResponse, RecordingSegment
from app.services import evidence_clips


def _clip(start: datetime, end: datetime) -> EvidenceClipResponse:
    return EvidenceClipResponse(
        id="clip-1234abcd",
        recordingId="seg-camera-test",
        cameraId="cam-test",
        startTime=start,
        endTime=end,
        reason="test",
        clipUrl="/api/recordings/clips/clip-1234abcd/media",
        status="queued",
        createdAt=start,
    )


def test_build_render_plan_spans_segments(tmp_path, monkeypatch):
    start = datetime(2026, 7, 11, 10, 0, tzinfo=UTC)
    first_file = tmp_path / "first.mp4"
    second_file = tmp_path / "second.mp4"
    first_file.write_bytes(b"first")
    second_file.write_bytes(b"second")
    segments = [
        RecordingSegment(
            id="seg-first",
            cameraId="cam-test",
            mediaPath="camera-test",
            filePath="first.mp4",
            mediaUrl="/first",
            startTime=start,
            endTime=start + timedelta(seconds=60),
            duration=60,
            fileSize=65_536,
        ),
        RecordingSegment(
            id="seg-second",
            cameraId="cam-test",
            mediaPath="camera-test",
            filePath="second.mp4",
            mediaUrl="/second",
            startTime=start + timedelta(seconds=60),
            endTime=start + timedelta(seconds=120),
            duration=60,
            fileSize=65_536,
        ),
    ]

    monkeypatch.setattr(evidence_clips, "list_recording_segments", lambda **_: segments)
    monkeypatch.setattr(
        evidence_clips,
        "get_recording_segment_file",
        lambda segment_id: {
            "seg-first": first_file,
            "seg-second": second_file,
        }.get(segment_id),
    )

    plan = evidence_clips._build_render_plan(
        _clip(start + timedelta(seconds=30), start + timedelta(seconds=90)),
        [],
    )

    assert plan is not None
    assert [source.path for source in plan.sources] == [first_file, second_file]
    assert plan.offset_seconds == 30
    assert plan.duration_seconds == 60


def test_build_render_plan_can_use_daily_archive(tmp_path):
    start = datetime(2026, 7, 11, 10, 0, tzinfo=UTC)
    archive_file = tmp_path / "daily.mp4"
    archive_file.write_bytes(b"archive")
    source = evidence_clips.ClipSource(
        path=archive_file,
        start_time=start,
        end_time=start + timedelta(hours=24),
    )

    plan = evidence_clips._build_single_source_plan(
        _clip(start + timedelta(hours=2), start + timedelta(hours=2, seconds=60)),
        source,
    )

    assert plan is not None
    assert plan.sources == [source]
    assert plan.offset_seconds == 2 * 60 * 60
    assert plan.duration_seconds == 60


def test_render_plan_does_not_cover_a_gap_between_segments(tmp_path):
    start = datetime(2026, 7, 11, 10, 0, tzinfo=UTC)
    plan = evidence_clips.ClipRenderPlan(
        sources=[
            evidence_clips.ClipSource(
                path=tmp_path / "one.mp4",
                start_time=start,
                end_time=start + timedelta(seconds=30),
            ),
            evidence_clips.ClipSource(
                path=tmp_path / "two.mp4",
                start_time=start + timedelta(seconds=35),
                end_time=start + timedelta(seconds=60),
            ),
        ],
        offset_seconds=0,
        duration_seconds=60,
    )

    assert not evidence_clips._plan_covers_request(
        plan,
        _clip(start, start + timedelta(seconds=60)),
        tolerance_seconds=1,
    )


def test_wait_for_render_plan_fails_when_only_partial_sources_exist(
    tmp_path,
    monkeypatch,
):
    start = datetime.now(UTC) - timedelta(minutes=5)
    clip = _clip(start, start + timedelta(seconds=60))
    partial_plan = evidence_clips.ClipRenderPlan(
        sources=[
            evidence_clips.ClipSource(
                path=tmp_path / "partial.mp4",
                start_time=start,
                end_time=start + timedelta(seconds=30),
            )
        ],
        offset_seconds=0,
        duration_seconds=30,
    )
    monkeypatch.setattr(
        evidence_clips,
        "get_settings",
        lambda: SimpleNamespace(
            evidence_clip_source_wait_seconds=0,
            evidence_clip_gap_tolerance_seconds=1,
            media_record_segment_duration_seconds=60,
        ),
    )
    monkeypatch.setattr(
        evidence_clips,
        "_build_render_plan",
        lambda *_: partial_plan,
    )

    with pytest.raises(
        evidence_clips.EvidenceClipProcessingError,
        match="belum lengkap",
    ):
        asyncio.run(evidence_clips._wait_for_render_plan(clip, []))


def test_ffmpeg_command_reencodes_to_browser_safe_mp4(tmp_path):
    command = evidence_clips._ffmpeg_command(
        ffmpeg_binary="ffmpeg",
        manifest_path=tmp_path / "sources.ffconcat",
        output_path=tmp_path / "clip.mp4",
        offset_seconds=12.3456,
        duration_seconds=45.6789,
    )

    assert command[0] == "ffmpeg"
    assert command[command.index("-ss") + 1] == "12.346"
    assert command[command.index("-t") + 1] == "45.679"
    assert command[command.index("-c:v") + 1] == "libx264"
    assert command[command.index("-movflags") + 1] == "+faststart"


def test_concat_manifest_contains_each_source(tmp_path):
    start = datetime(2026, 7, 11, tzinfo=UTC)
    sources = [
        evidence_clips.ClipSource(
            path=tmp_path / "one.mp4",
            start_time=start,
            end_time=start + timedelta(seconds=60),
        ),
        evidence_clips.ClipSource(
            path=tmp_path / "two.mp4",
            start_time=start + timedelta(seconds=60),
            end_time=start + timedelta(seconds=120),
        ),
    ]

    manifest = evidence_clips._concat_manifest(sources)

    assert manifest.splitlines()[0] == "ffconcat version 1.0"
    assert "one.mp4" in manifest
    assert "two.mp4" in manifest


def test_evidence_clip_file_rejects_invalid_id(tmp_path, monkeypatch):
    monkeypatch.setattr(
        evidence_clips,
        "get_settings",
        lambda: SimpleNamespace(media_clips_dir=str(tmp_path)),
    )
    (tmp_path / "clip-1234abcd.mp4").write_bytes(b"mp4")

    assert (
        evidence_clips.get_evidence_clip_file("clip-1234abcd")
        == (tmp_path / "clip-1234abcd.mp4").resolve()
    )
    assert evidence_clips.get_evidence_clip_file("../secret") is None


def test_cleanup_expired_evidence_clips_removes_database_rows_and_files(
    tmp_path,
    monkeypatch,
):
    now = datetime(2026, 8, 2, 12, 0, tzinfo=UTC)
    settings = SimpleNamespace(
        evidence_clip_retention_days=7,
        media_clips_dir=str(tmp_path),
    )
    captured: dict[str, object] = {}

    class SessionContext:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *_):
            return None

    async def fake_delete_expired(session, cutoff):
        captured["session"] = session
        captured["cutoff"] = cutoff
        return ["clip-1234abcd"]

    monkeypatch.setattr(evidence_clips, "AsyncSessionLocal", SessionContext)
    monkeypatch.setattr(
        evidence_clips,
        "delete_expired_evidence_clip_models",
        fake_delete_expired,
    )

    for name in (
        "clip-1234abcd.mp4",
        ".clip-1234abcd.ffconcat",
        ".clip-1234abcd.part.mp4",
    ):
        (tmp_path / name).write_bytes(b"test")

    deleted = asyncio.run(
        evidence_clips.cleanup_expired_evidence_clips(settings, now=now)
    )

    assert deleted == 1
    assert captured["cutoff"] == now - timedelta(days=7)
    assert not list(tmp_path.iterdir())
