from __future__ import annotations

import asyncio
import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


class MediaValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class MediaProbeResult:
    duration_seconds: float
    has_video: bool


def uncovered_duration_seconds(
    intervals: Iterable[tuple[datetime, datetime]],
    required_start: datetime,
    required_end: datetime,
) -> float:
    if required_end <= required_start:
        return 0.0

    cursor = required_start
    uncovered = 0.0
    for start_time, end_time in sorted(intervals, key=lambda item: item[0]):
        bounded_start = max(start_time, required_start)
        bounded_end = min(end_time, required_end)
        if bounded_end <= bounded_start or bounded_end <= cursor:
            continue
        if bounded_start > cursor:
            uncovered += (bounded_start - cursor).total_seconds()
        cursor = max(cursor, bounded_end)
        if cursor >= required_end:
            break

    if cursor < required_end:
        uncovered += (required_end - cursor).total_seconds()
    return max(0.0, uncovered)


def covers_time_range(
    intervals: Iterable[tuple[datetime, datetime]],
    required_start: datetime,
    required_end: datetime,
    *,
    tolerance_seconds: float,
) -> bool:
    return uncovered_duration_seconds(
        intervals,
        required_start,
        required_end,
    ) <= max(0.0, tolerance_seconds)


async def probe_rendered_video(
    file_path: Path,
    *,
    ffprobe_binary: str,
    timeout_seconds: float,
) -> MediaProbeResult:
    command = [
        ffprobe_binary,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_entries",
        "format=duration:stream=codec_type",
        str(file_path),
    ]
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as error:
        raise MediaValidationError("FFprobe tidak tersedia.") from error

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=max(1.0, timeout_seconds),
        )
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise MediaValidationError(
            "FFprobe melewati batas waktu pemeriksaan."
        ) from error

    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="replace").strip()[-800:]
        raise MediaValidationError(message or "Hasil video tidak dapat diperiksa.")

    try:
        payload = json.loads(stdout.decode("utf-8"))
        duration = float(payload.get("format", {}).get("duration"))
        streams = payload.get("streams", [])
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise MediaValidationError("Metadata hasil video tidak valid.") from error

    return MediaProbeResult(
        duration_seconds=duration,
        has_video=any(item.get("codec_type") == "video" for item in streams),
    )


def validate_media_probe(
    probe: MediaProbeResult,
    *,
    expected_duration_seconds: float,
    tolerance_seconds: float,
) -> None:
    expected = max(0.0, expected_duration_seconds)
    tolerance = max(0.0, tolerance_seconds)
    if not probe.has_video:
        raise MediaValidationError("Hasil video tidak memiliki stream gambar.")
    if not math.isfinite(probe.duration_seconds) or probe.duration_seconds <= 0:
        raise MediaValidationError("Durasi hasil video tidak valid.")
    if abs(probe.duration_seconds - expected) > tolerance:
        raise MediaValidationError(
            "Durasi hasil video tidak sesuai: "
            f"diharapkan {expected:.2f} detik, didapat "
            f"{probe.duration_seconds:.2f} detik."
        )


async def validate_rendered_video(
    file_path: Path,
    *,
    expected_duration_seconds: float,
    duration_tolerance_seconds: float,
    ffprobe_binary: str,
    timeout_seconds: float,
) -> MediaProbeResult:
    probe = await probe_rendered_video(
        file_path,
        ffprobe_binary=ffprobe_binary,
        timeout_seconds=timeout_seconds,
    )
    validate_media_probe(
        probe,
        expected_duration_seconds=expected_duration_seconds,
        tolerance_seconds=duration_tolerance_seconds,
    )
    return probe
