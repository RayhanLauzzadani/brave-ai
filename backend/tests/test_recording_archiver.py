from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.schemas import RecordingSegment
from app.services import recording_archiver


def _segment(start: datetime, index: int) -> RecordingSegment:
    segment_start = start + timedelta(seconds=index * 60)
    return RecordingSegment(
        id=f"seg-{index}",
        cameraId="cam-test",
        mediaPath="camera-test",
        filePath=f"camera-test/{index}.mp4",
        mediaUrl=f"/api/recordings/segments/seg-{index}/media",
        startTime=segment_start,
        endTime=segment_start + timedelta(seconds=60),
        duration=60,
        fileSize=65_536,
    )


def test_complete_continuous_session_becomes_one_archive_window():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    segments = [_segment(start, index) for index in range(3)]

    result = recording_archiver.build_archive_windows(
        segments,
        session_duration_seconds=180,
        expected_segment_seconds=60,
        gap_tolerance_seconds=10,
    )

    assert len(result) == 1
    assert result[0].start_time == start
    assert result[0].end_time == start + timedelta(seconds=180)
    assert result[0].duration_seconds == 180
    assert len(result[0].segments) == 3


def test_active_incomplete_session_is_not_exposed_as_archive():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    segments = [_segment(start, index) for index in range(2)]

    result = recording_archiver.build_archive_windows(
        segments,
        session_duration_seconds=180,
        expected_segment_seconds=60,
        gap_tolerance_seconds=10,
        active_source_keys={("cam-test", "camera-test")},
    )

    assert result == []


def test_stopped_incomplete_session_becomes_an_archive():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    segments = [_segment(start, index) for index in range(2)]

    result = recording_archiver.build_archive_windows(
        segments,
        session_duration_seconds=180,
        expected_segment_seconds=60,
        gap_tolerance_seconds=10,
        active_source_keys=set(),
    )

    assert len(result) == 1
    assert result[0].start_time == start
    assert result[0].end_time == start + timedelta(seconds=120)
    assert result[0].duration_seconds == 120


def test_cumulative_segment_gaps_do_not_become_a_complete_archive():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    segments = [
        _segment(start, 0),
        _segment(start + timedelta(seconds=61), 0),
        _segment(start + timedelta(seconds=122), 0),
    ]

    result = recording_archiver.build_archive_windows(
        segments,
        session_duration_seconds=180,
        expected_segment_seconds=60,
        gap_tolerance_seconds=1,
    )

    assert result == []


def test_camera_disconnect_archives_old_session_and_keeps_current_session_open():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    segments = [_segment(start, 0), _segment(start, 1)]
    reconnect_start = start + timedelta(seconds=131)
    segments.extend([_segment(reconnect_start, 0), _segment(reconnect_start, 1)])

    result = recording_archiver.build_archive_windows(
        segments,
        session_duration_seconds=180,
        expected_segment_seconds=60,
        gap_tolerance_seconds=10,
        active_source_keys={("cam-test", "camera-test")},
    )

    assert len(result) == 1
    assert result[0].start_time == start
    assert result[0].end_time == start + timedelta(seconds=120)


def test_long_running_camera_produces_consecutive_daily_windows():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    segments = [_segment(start, index) for index in range(6)]

    result = recording_archiver.build_archive_windows(
        segments,
        session_duration_seconds=180,
        expected_segment_seconds=60,
        gap_tolerance_seconds=10,
    )

    assert [window.start_time for window in result] == [
        start,
        start + timedelta(seconds=180),
    ]


def test_archive_cursor_prevents_overlapping_windows_when_raw_retention_moves():
    original_start = datetime(2026, 8, 1, tzinfo=UTC)
    retained_start = original_start + timedelta(seconds=60)
    segments = [_segment(retained_start, index) for index in range(5)]

    result = recording_archiver.build_archive_windows(
        segments,
        session_duration_seconds=180,
        expected_segment_seconds=60,
        gap_tolerance_seconds=10,
        resume_after_by_source={
            ("cam-test", "camera-test"): original_start + timedelta(seconds=180),
        },
    )

    assert [window.start_time for window in result] == [
        original_start + timedelta(seconds=180),
    ]


def test_archive_ffmpeg_command_compresses_for_browser_playback(tmp_path):
    settings = SimpleNamespace(
        ffmpeg_binary="ffmpeg",
        recording_archive_video_max_width=960,
        recording_archive_video_max_height=540,
        recording_archive_video_fps=12,
        recording_archive_video_preset="veryfast",
        recording_archive_video_crf=30,
        recording_archive_video_max_bitrate_kbps=900,
        recording_archive_audio_bitrate_kbps=48,
    )

    command = recording_archiver.archive_ffmpeg_command(
        settings=settings,
        manifest_path=tmp_path / "sources.ffconcat",
        output_path=tmp_path / "archive.mp4",
        offset_seconds=0,
        duration_seconds=86_400,
    )

    assert command[command.index("-c:v") + 1] == "libx264"
    assert command[command.index("-crf") + 1] == "30"
    assert command[command.index("-maxrate") + 1] == "900k"
    assert command[command.index("-movflags") + 1] == "+faststart"
    assert "fps=12" in command[command.index("-vf") + 1]


def test_archive_file_resolver_rejects_paths_outside_archive(tmp_path):
    archive_root = tmp_path / "archives"
    archive_root.mkdir()
    valid_file = archive_root / "cam-test" / "daily.mp4"
    valid_file.parent.mkdir()
    valid_file.write_bytes(b"video")
    outside_file = tmp_path / "secret.mp4"
    outside_file.write_bytes(b"secret")
    settings = SimpleNamespace(media_archive_dir=str(archive_root))

    assert (
        recording_archiver.resolve_archive_file(
            "cam-test/daily.mp4",
            settings,
        )
        == valid_file.resolve()
    )
    assert (
        recording_archiver.resolve_archive_file(
            "../secret.mp4",
            settings,
        )
        is None
    )
