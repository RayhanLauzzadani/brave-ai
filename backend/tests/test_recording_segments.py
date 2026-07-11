from types import SimpleNamespace

from app.services import recording_segments


def test_small_recording_fragments_are_ignored(tmp_path, monkeypatch):
    root = tmp_path / "recordings"
    segment_dir = root / "camera-test" / "2026-07-11"
    segment_dir.mkdir(parents=True)

    small_file = segment_dir / "09-00-00-000000.mp4"
    playable_file = segment_dir / "09-01-00-000000.mp4"
    small_file.write_bytes(b"x" * 9_749)
    playable_file.write_bytes(b"x" * 65_536)

    monkeypatch.setattr(
        recording_segments,
        "get_settings",
        lambda: SimpleNamespace(
            media_recordings_dir=str(root),
            media_record_segment_duration_seconds=60,
            media_record_min_file_size_bytes=65_536,
        ),
    )

    result = recording_segments.list_recording_segments(media_path="camera-test")

    assert [segment.file_size for segment in result] == [65_536]
    assert recording_segments.get_recording_segment_file(result[0].id) == playable_file.resolve()
    assert recording_segments.get_recording_segment_file(
        "seg-camera-test-2026-07-11-09-00-00-000000-mp4"
    ) is None