from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

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

    assert evidence_clips.get_evidence_clip_file("clip-1234abcd") == (
        tmp_path / "clip-1234abcd.mp4"
    ).resolve()
    assert evidence_clips.get_evidence_clip_file("../secret") is None