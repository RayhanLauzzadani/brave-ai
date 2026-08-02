from datetime import UTC, datetime, timedelta

import pytest

from app.services.media_validation import (
    MediaProbeResult,
    MediaValidationError,
    covers_time_range,
    uncovered_duration_seconds,
    validate_media_probe,
)


def test_coverage_counts_gaps_between_segments():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    intervals = [
        (start, start + timedelta(seconds=30)),
        (start + timedelta(seconds=35), start + timedelta(seconds=60)),
    ]

    assert (
        uncovered_duration_seconds(
            intervals,
            start,
            start + timedelta(seconds=60),
        )
        == 5
    )
    assert not covers_time_range(
        intervals,
        start,
        start + timedelta(seconds=60),
        tolerance_seconds=1,
    )


def test_coverage_merges_overlapping_segments():
    start = datetime(2026, 8, 1, tzinfo=UTC)
    intervals = [
        (start, start + timedelta(seconds=35)),
        (start + timedelta(seconds=30), start + timedelta(seconds=60)),
    ]

    assert covers_time_range(
        intervals,
        start,
        start + timedelta(seconds=60),
        tolerance_seconds=0,
    )


def test_media_probe_rejects_output_that_is_too_short():
    with pytest.raises(MediaValidationError, match="Durasi hasil video tidak sesuai"):
        validate_media_probe(
            MediaProbeResult(duration_seconds=40, has_video=True),
            expected_duration_seconds=60,
            tolerance_seconds=2,
        )


def test_media_probe_requires_video_stream():
    with pytest.raises(MediaValidationError, match="stream gambar"):
        validate_media_probe(
            MediaProbeResult(duration_seconds=60, has_video=False),
            expected_duration_seconds=60,
            tolerance_seconds=2,
        )


def test_media_probe_accepts_small_duration_difference():
    validate_media_probe(
        MediaProbeResult(duration_seconds=59.25, has_video=True),
        expected_duration_seconds=60,
        tolerance_seconds=2,
    )
