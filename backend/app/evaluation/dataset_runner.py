from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import html
import json
import math
import subprocess
import sys
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.evaluation.metrics import (
    LABEL_BULLYING,
    LABEL_NON_BULLYING,
    ClassifiedSample,
    calculate_metrics,
    predicted_label,
    threshold_metrics,
)
from app.services.gemini_classifier import (
    CLASSIFICATION_PROMPT,
    GeminiVideoClassifier,
)

DATASET_SCHEMA_VERSION = "ai-evaluation.v2"
VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".mkv", ".avi", ".webm"})
LABELS = (LABEL_BULLYING, LABEL_NON_BULLYING)
LABEL_UNCERTAIN = "uncertain"
MANUAL_LABELS = frozenset((*LABELS, LABEL_UNCERTAIN))
DEFAULT_MODEL_NAME = "gemini-3.1-flash-lite"
DEFAULT_VIDEO_FPS = 10.0
THRESHOLDS = tuple(round(index / 100, 2) for index in range(50, 100, 5))


class DatasetRunnerError(RuntimeError):
    """Raised when an evaluation cannot be prepared or completed."""


@dataclass(frozen=True)
class DatasetSource:
    label: str
    path: Path
    relative_path: str
    duration_seconds: float
    source_hash: str


@dataclass(frozen=True)
class DatasetIssue:
    label: str | None
    relative_path: str
    message: str

    def as_dict(self) -> dict[str, str | None]:
        return {
            "label": self.label,
            "relativePath": self.relative_path,
            "message": self.message,
        }


@dataclass(frozen=True)
class ManualAnnotation:
    review_id: str
    source_path: str
    segment_index: int
    start_seconds: float
    end_seconds: float
    manual_label: str
    notes: str


@dataclass(frozen=True)
class SegmentSpec:
    sample_id: str
    source: DatasetSource
    segment_index: int
    start_seconds: float
    duration_seconds: float
    pad_to_duration: bool
    model_name: str = DEFAULT_MODEL_NAME
    video_fps: float = DEFAULT_VIDEO_FPS
    actual_label: str | None = None
    actual_label_source: str = "folder"
    annotation_id: str | None = None
    annotation_notes: str | None = None

    @property
    def resolved_label(self) -> str:
        return self.actual_label or self.source.label

    @property
    def cache_key(self) -> str:
        prompt_hash = hashlib.sha256(
            CLASSIFICATION_PROMPT.encode("utf-8")
        ).hexdigest()
        material = "|".join(
            (
                self.source.source_hash,
                self.source.relative_path,
                self.source.label,
                f"{self.start_seconds:.3f}",
                f"{self.duration_seconds:.3f}",
                prompt_hash,
                self.model_name,
                f"{self.video_fps:g}",
            )
        )
        return hashlib.sha256(material.encode("utf-8")).hexdigest()


@dataclass
class EvaluationResult:
    sample_id: str
    cache_key: str
    actual_label: str
    source_path: str
    source_duration_seconds: float
    segment_index: int
    start_seconds: float
    duration_seconds: float
    status: str
    actual_label_source: str = "folder"
    annotation_id: str | None = None
    annotation_notes: str | None = None
    gemini_requested: bool = False
    raw_prediction: str | None = None
    confidence: float | None = None
    reason: str | None = None
    observations: str | None = None
    contact_analysis: str | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": DATASET_SCHEMA_VERSION,
            "sampleId": self.sample_id,
            "cacheKey": self.cache_key,
            "actualLabel": self.actual_label,
            "actualLabelSource": self.actual_label_source,
            "annotationId": self.annotation_id,
            "annotationNotes": self.annotation_notes,
            "sourcePath": self.source_path,
            "sourceDurationSeconds": self.source_duration_seconds,
            "segmentIndex": self.segment_index,
            "startSeconds": self.start_seconds,
            "durationSeconds": self.duration_seconds,
            "status": self.status,
            "geminiRequested": self.gemini_requested,
            "rawPrediction": self.raw_prediction,
            "confidence": self.confidence,
            "reason": self.reason,
            "observations": self.observations,
            "contactAnalysis": self.contact_analysis,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> EvaluationResult:
        return cls(
            sample_id=str(value["sampleId"]),
            cache_key=str(value["cacheKey"]),
            actual_label=str(value["actualLabel"]),
            actual_label_source=str(value.get("actualLabelSource", "folder")),
            annotation_id=_optional_string(value.get("annotationId")),
            annotation_notes=_optional_string(value.get("annotationNotes")),
            source_path=str(value["sourcePath"]),
            source_duration_seconds=float(value["sourceDurationSeconds"]),
            segment_index=int(value["segmentIndex"]),
            start_seconds=float(value["startSeconds"]),
            duration_seconds=float(value["durationSeconds"]),
            status=str(value["status"]),
            gemini_requested=bool(value.get("geminiRequested", False)),
            raw_prediction=_optional_string(value.get("rawPrediction")),
            confidence=_optional_float(value.get("confidence")),
            reason=_optional_string(value.get("reason")),
            observations=_optional_string(value.get("observations")),
            contact_analysis=_optional_string(value.get("contactAnalysis")),
            error=_optional_string(value.get("error")),
        )


def scan_dataset(
    dataset_dir: Path,
    *,
    ffprobe_binary: str = "ffprobe",
) -> tuple[list[DatasetSource], list[DatasetIssue]]:
    if not dataset_dir.is_dir():
        raise DatasetRunnerError(f"Folder dataset tidak ditemukan: {dataset_dir}")

    sources: list[DatasetSource] = []
    issues: list[DatasetIssue] = []
    for label in LABELS:
        label_dir = dataset_dir / label
        if not label_dir.is_dir():
            issues.append(
                DatasetIssue(label=label, relative_path=label, message="Folder label tidak ditemukan.")
            )
            continue

        paths = sorted(
            path
            for path in label_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
        )
        for path in paths:
            relative_path = path.relative_to(dataset_dir).as_posix()
            try:
                duration = probe_duration(path, ffprobe_binary)
                if duration < 1.0:
                    raise DatasetRunnerError(
                        "Durasi video kurang dari 1 detik dan tidak dapat dievaluasi."
                    )
                sources.append(
                    DatasetSource(
                        label=label,
                        path=path,
                        relative_path=relative_path,
                        duration_seconds=duration,
                        source_hash=hash_file(path),
                    )
                )
            except (DatasetRunnerError, OSError) as error:
                issues.append(
                    DatasetIssue(
                        label=label,
                        relative_path=relative_path,
                        message=str(error),
                    )
                )

    return sources, issues


def load_manual_annotations(path: Path) -> dict[tuple[str, int], ManualAnnotation]:
    if not path.is_file():
        raise DatasetRunnerError(f"File anotasi manual tidak ditemukan: {path}")

    required_fields = {
        "review_id",
        "source_path",
        "segment_index",
        "start_seconds",
        "end_seconds",
        "manual_label",
        "notes",
    }
    annotations: dict[tuple[str, int], ManualAnnotation] = {}
    with path.open("r", newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        missing_fields = required_fields.difference(reader.fieldnames or [])
        if missing_fields:
            missing = ", ".join(sorted(missing_fields))
            raise DatasetRunnerError(f"Kolom anotasi manual tidak lengkap: {missing}")

        for row_number, row in enumerate(reader, start=2):
            try:
                source_path = str(row["source_path"]).strip().replace("\\", "/")
                segment_index = int(row["segment_index"])
                start_seconds = float(row["start_seconds"])
                end_seconds = float(row["end_seconds"])
                manual_label = str(row["manual_label"]).strip().lower()
            except (TypeError, ValueError) as error:
                raise DatasetRunnerError(
                    f"Anotasi manual baris {row_number} memiliki nilai tidak valid."
                ) from error

            if not source_path:
                raise DatasetRunnerError(
                    f"Anotasi manual baris {row_number} tidak memiliki source_path."
                )
            if manual_label not in MANUAL_LABELS:
                allowed = ", ".join(sorted(MANUAL_LABELS))
                raise DatasetRunnerError(
                    f"Label manual baris {row_number} tidak valid; gunakan: {allowed}."
                )
            if end_seconds <= start_seconds:
                raise DatasetRunnerError(
                    f"Rentang waktu anotasi baris {row_number} tidak valid."
                )

            key = (source_path, segment_index)
            if key in annotations:
                raise DatasetRunnerError(
                    f"Anotasi manual duplikat untuk {source_path} segmen {segment_index}."
                )
            annotations[key] = ManualAnnotation(
                review_id=str(row["review_id"]).strip(),
                source_path=source_path,
                segment_index=segment_index,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                manual_label=manual_label,
                notes=str(row["notes"]).strip(),
            )

    if not annotations:
        raise DatasetRunnerError("File anotasi manual tidak berisi data.")
    return annotations


def apply_manual_annotations(
    segments: list[SegmentSpec],
    annotations: dict[tuple[str, int], ManualAnnotation],
) -> list[SegmentSpec]:
    resolved: list[SegmentSpec] = []
    used_keys: set[tuple[str, int]] = set()
    missing: list[str] = []

    for segment in segments:
        key = (segment.source.relative_path.replace("\\", "/"), segment.segment_index)
        annotation = annotations.get(key)
        if annotation is None:
            missing.append(f"{key[0]}#{key[1]}")
            continue
        if not math.isclose(
            annotation.start_seconds,
            segment.start_seconds,
            abs_tol=0.02,
        ):
            raise DatasetRunnerError(
                "Waktu awal anotasi tidak cocok untuk "
                f"{key[0]} segmen {key[1]}: {annotation.start_seconds:.3f} vs "
                f"{segment.start_seconds:.3f}."
            )
        expected_end = segment.start_seconds + segment.duration_seconds
        if not math.isclose(annotation.end_seconds, expected_end, abs_tol=0.02):
            raise DatasetRunnerError(
                "Waktu akhir anotasi tidak cocok untuk "
                f"{key[0]} segmen {key[1]}: {annotation.end_seconds:.3f} vs "
                f"{expected_end:.3f}."
            )
        resolved.append(
            replace(
                segment,
                actual_label=annotation.manual_label,
                actual_label_source="manual",
                annotation_id=annotation.review_id or None,
                annotation_notes=annotation.notes or None,
            )
        )
        used_keys.add(key)

    unused = sorted(set(annotations).difference(used_keys))
    if missing or unused:
        details: list[str] = []
        if missing:
            details.append(
                f"{len(missing)} segmen tanpa anotasi ({', '.join(missing[:3])})"
            )
        if unused:
            previews = [f"{path}#{index}" for path, index in unused[:3]]
            details.append(
                f"{len(unused)} anotasi tidak cocok ({', '.join(previews)})"
            )
        raise DatasetRunnerError("Anotasi manual tidak lengkap: " + "; ".join(details))

    return resolved


def probe_duration(path: Path, ffprobe_binary: str = "ffprobe") -> float:
    command = [
        ffprobe_binary,
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        str(path),
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except FileNotFoundError as error:
        raise DatasetRunnerError(
            f"FFprobe tidak ditemukan: {ffprobe_binary}"
        ) from error
    except subprocess.TimeoutExpired as error:
        raise DatasetRunnerError("FFprobe timeout saat membaca video.") from error

    if completed.returncode != 0:
        detail = completed.stderr.strip()[-400:]
        raise DatasetRunnerError(detail or "FFprobe gagal membaca video.")

    try:
        payload = json.loads(completed.stdout)
    except (TypeError, ValueError) as error:
        raise DatasetRunnerError(
            "FFprobe tidak mengembalikan JSON valid."
        ) from error

    if not isinstance(payload, dict):
        raise DatasetRunnerError("FFprobe mengembalikan object JSON yang tidak valid.")

    streams = payload.get("streams")
    if not isinstance(streams, list) or not any(
        isinstance(stream, dict) and stream.get("codec_type") == "video"
        for stream in streams
    ):
        raise DatasetRunnerError("File tidak memiliki stream video.")

    format_info = payload.get("format")
    raw_duration = format_info.get("duration") if isinstance(format_info, dict) else None
    try:
        duration = float(raw_duration)
    except (TypeError, ValueError) as error:
        raise DatasetRunnerError("FFprobe tidak mengembalikan durasi valid.") from error
    if not math.isfinite(duration) or duration <= 0:
        raise DatasetRunnerError("Durasi video tidak valid.")
    return duration


def build_segments(
    source: DatasetSource,
    *,
    clip_seconds: float = 3.0,
    model_name: str = DEFAULT_MODEL_NAME,
    video_fps: float = DEFAULT_VIDEO_FPS,
) -> list[SegmentSpec]:
    if clip_seconds <= 0:
        raise ValueError("clip_seconds harus lebih besar dari nol")

    duration = source.duration_seconds
    starts: list[tuple[float, bool]]
    if duration < clip_seconds:
        starts = [(0.0, True)]
    elif duration <= clip_seconds * 2:
        starts = [((duration - clip_seconds) / 2, False)]
    else:
        segment_count = int(duration // clip_seconds)
        starts = [(index * clip_seconds, False) for index in range(segment_count)]

    return [
        SegmentSpec(
            sample_id=_sample_id(source, index, start, clip_seconds),
            source=source,
            segment_index=index,
            start_seconds=start,
            duration_seconds=clip_seconds,
            pad_to_duration=pad,
            model_name=model_name,
            video_fps=video_fps,
        )
        for index, (start, pad) in enumerate(starts)
    ]


def build_ffmpeg_command(
    segment: SegmentSpec,
    output_path: Path,
    *,
    ffmpeg_binary: str = "ffmpeg",
    fps: float = DEFAULT_VIDEO_FPS,
) -> list[str]:
    filters = [f"fps={fps:g}", "scale=640:-2", "format=yuv420p"]
    if segment.pad_to_duration:
        padding = max(segment.duration_seconds - segment.source.duration_seconds, 0.0)
        filters.append(f"tpad=stop_mode=clone:stop_duration={padding:.3f}")
    return [
        ffmpeg_binary,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{segment.start_seconds:.3f}",
        "-i",
        str(segment.source.path),
        "-t",
        f"{segment.duration_seconds:.3f}",
        "-an",
        "-vf",
        ",".join(filters),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-movflags",
        "+faststart",
        "-y",
        str(output_path),
    ]


def normalize_segment(
    segment: SegmentSpec,
    output_path: Path,
    *,
    ffmpeg_binary: str,
    fps: float,
    max_bytes: int,
) -> None:
    command = build_ffmpeg_command(
        segment,
        output_path,
        ffmpeg_binary=ffmpeg_binary,
        fps=fps,
    )
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except FileNotFoundError as error:
        raise DatasetRunnerError(
            f"FFmpeg tidak ditemukan: {ffmpeg_binary}"
        ) from error
    except subprocess.TimeoutExpired as error:
        raise DatasetRunnerError("FFmpeg timeout saat menormalisasi klip.") from error

    if completed.returncode != 0:
        detail = completed.stderr.strip()[-500:]
        raise DatasetRunnerError(detail or "FFmpeg gagal menormalisasi klip.")
    if not output_path.is_file() or output_path.stat().st_size < 1024:
        raise DatasetRunnerError("FFmpeg menghasilkan klip kosong.")
    if output_path.stat().st_size > max_bytes:
        raise DatasetRunnerError("Klip hasil normalisasi melebihi batas Gemini.")


async def run_evaluation(
    settings: Settings,
    *,
    dataset_dir: Path,
    output_dir: Path,
    threshold: float,
    clip_seconds: float,
    concurrency: int,
    limit_per_label: int | None = None,
    resume: bool = False,
    run_id: str | None = None,
    annotations_file: Path | None = None,
    ffmpeg_binary: str | None = None,
    ffprobe_binary: str = "ffprobe",
) -> dict[str, Any]:
    if not 0 <= threshold <= 1:
        raise DatasetRunnerError("Threshold harus berada di antara 0 dan 1.")
    if concurrency < 1:
        raise DatasetRunnerError("Concurrency minimal bernilai 1.")

    run_started_at = datetime.now(UTC)
    sources, scan_issues = scan_dataset(
        dataset_dir,
        ffprobe_binary=ffprobe_binary,
    )
    segments = [
        segment
        for source in sources
        for segment in build_segments(
            source,
            clip_seconds=clip_seconds,
            model_name=settings.gemini_model_name,
            video_fps=settings.gemini_video_fps,
        )
    ]
    if annotations_file is not None:
        segments = apply_manual_annotations(
            segments,
            load_manual_annotations(annotations_file),
        )
    segments = limit_segments(segments, limit_per_label)
    sources = sources_for_segments(sources, segments)
    run_dir = prepare_run_dir(output_dir, run_id=run_id, resume=resume)
    manifest_path = run_dir / "manifest.json"
    raw_results_path = run_dir / "raw-results.jsonl"
    write_manifest(
        manifest_path,
        {
            "schemaVersion": DATASET_SCHEMA_VERSION,
            "runId": run_dir.name,
            "complete": False,
            "startedAt": run_started_at.isoformat(),
            "datasetDirectory": str(dataset_dir),
            "threshold": threshold,
            "clipSeconds": clip_seconds,
            "videoFps": settings.gemini_video_fps,
            "model": settings.gemini_model_name,
            "annotationsFile": str(annotations_file) if annotations_file else None,
        },
        merge_existing=True,
    )

    cached = load_cached_results(raw_results_path)
    cache_hit_count = sum(
        1 for segment in segments if segment.cache_key in cached
    )
    results: dict[str, EvaluationResult] = {
        segment.sample_id: bind_result_to_segment(
            cached[segment.cache_key],
            segment,
        )
        for segment in segments
        if segment.cache_key in cached
    }
    pending = [segment for segment in segments if segment.sample_id not in results]
    write_manifest(
        manifest_path,
        {
            "pendingCount": len(pending),
            "cacheHitCount": cache_hit_count,
        },
        merge_existing=True,
    )

    if pending:
        client_timeout = settings.gemini_request_timeout_seconds
        async with httpx.AsyncClient(timeout=client_timeout) as client:
            classifier = GeminiVideoClassifier(settings=settings, client=client)
            semaphore = asyncio.Semaphore(concurrency)
            tasks = [
                asyncio.create_task(
                    evaluate_segment(
                        segment,
                        classifier,
                        semaphore,
                        settings=settings,
                        ffmpeg_binary=ffmpeg_binary or settings.ffmpeg_binary,
                    )
                )
                for segment in pending
            ]
            for task in asyncio.as_completed(tasks):
                result = await task
                results[result.sample_id] = result
                append_jsonl(raw_results_path, result.as_dict())

    ordered_results = [results[segment.sample_id] for segment in segments]
    request_count = sum(
        int(results[segment.sample_id].gemini_requested)
        for segment in pending
    )
    completed_at = datetime.now(UTC)
    summary = build_summary(
        run_id=run_dir.name,
        dataset_dir=dataset_dir,
        sources=sources,
        segments=segments,
        results=ordered_results,
        scan_issues=scan_issues,
        threshold=threshold,
        clip_seconds=clip_seconds,
        settings=settings,
        request_count=request_count,
        cache_hit_count=cache_hit_count,
        started_at=run_started_at,
        completed_at=completed_at,
    )
    write_json(run_dir / "summary.json", summary)
    write_results_csv(run_dir / "results.csv", ordered_results, threshold)
    (run_dir / "report.md").write_text(
        render_report(summary, ordered_results, threshold),
        encoding="utf-8",
    )
    (output_dir / "latest-summary.md").parent.mkdir(parents=True, exist_ok=True)
    (output_dir / "latest-summary.md").write_text(
        render_latest_summary(summary),
        encoding="utf-8",
    )
    write_manifest(
        manifest_path,
        {
            "schemaVersion": DATASET_SCHEMA_VERSION,
            "runId": run_dir.name,
            "complete": True,
            "completedAt": completed_at.isoformat(),
            "requestCount": request_count,
            "summaryPath": str(run_dir / "summary.json"),
        },
        merge_existing=True,
    )
    return summary


def bind_result_to_segment(
    result: EvaluationResult,
    segment: SegmentSpec,
) -> EvaluationResult:
    return replace(
        result,
        sample_id=segment.sample_id,
        actual_label=segment.resolved_label,
        actual_label_source=segment.actual_label_source,
        annotation_id=segment.annotation_id,
        annotation_notes=segment.annotation_notes,
        source_path=segment.source.relative_path,
        source_duration_seconds=segment.source.duration_seconds,
        segment_index=segment.segment_index,
        start_seconds=segment.start_seconds,
        duration_seconds=segment.duration_seconds,
    )


async def evaluate_segment(
    segment: SegmentSpec,
    classifier: GeminiVideoClassifier,
    semaphore: asyncio.Semaphore,
    *,
    settings: Settings,
    ffmpeg_binary: str,
) -> EvaluationResult:
    async with semaphore:
        gemini_requested = False
        try:
            with tempfile.TemporaryDirectory(prefix="brave-ai-eval-") as temp_dir:
                clip_path = Path(temp_dir) / f"{segment.sample_id}.mp4"
                await asyncio.to_thread(
                    normalize_segment,
                    segment,
                    clip_path,
                    ffmpeg_binary=ffmpeg_binary,
                    fps=settings.gemini_video_fps,
                    max_bytes=settings.gemini_inline_max_bytes,
                )
                video_bytes = await asyncio.to_thread(clip_path.read_bytes)
                gemini_requested = True
                classification = await classifier.classify(
                    video_bytes,
                    clip_duration_seconds=segment.duration_seconds,
                )
        # A single corrupt clip or provider failure must not abort the benchmark.
        except Exception as error:  # noqa: BLE001
            return EvaluationResult(
                sample_id=segment.sample_id,
                cache_key=segment.cache_key,
                actual_label=segment.resolved_label,
                actual_label_source=segment.actual_label_source,
                annotation_id=segment.annotation_id,
                annotation_notes=segment.annotation_notes,
                source_path=segment.source.relative_path,
                source_duration_seconds=segment.source.duration_seconds,
                segment_index=segment.segment_index,
                start_seconds=segment.start_seconds,
                duration_seconds=segment.duration_seconds,
                status="error",
                gemini_requested=gemini_requested,
                error=str(error),
            )

        return EvaluationResult(
            sample_id=segment.sample_id,
            cache_key=segment.cache_key,
            actual_label=segment.resolved_label,
            actual_label_source=segment.actual_label_source,
            annotation_id=segment.annotation_id,
            annotation_notes=segment.annotation_notes,
            source_path=segment.source.relative_path,
            source_duration_seconds=segment.source.duration_seconds,
            segment_index=segment.segment_index,
            start_seconds=segment.start_seconds,
            duration_seconds=segment.duration_seconds,
            status="classified",
            gemini_requested=True,
            raw_prediction=classification.prediction,
            confidence=classification.confidence,
            reason=classification.reason,
            observations=classification.kronologi_kejadian,
            contact_analysis=(
                f"Jumlah subjek: {classification.jumlah_subjek}; "
                f"ruangan kosong: {'ya' if classification.ruangan_kosong else 'tidak'}; "
                f"jenis kontak: {classification.jenis_kontak}; "
                "kontak agresif: "
                f"{'ya' if classification.ada_kontak_antar_subjek else 'tidak'}; "
                "detik mulai kontak: "
                f"{classification.detik_mulai_kontak}"
            ),
        )


def build_summary(
    *,
    run_id: str,
    dataset_dir: Path,
    sources: list[DatasetSource],
    segments: list[SegmentSpec],
    results: list[EvaluationResult],
    scan_issues: list[DatasetIssue],
    threshold: float,
    clip_seconds: float,
    settings: Settings,
    request_count: int = 0,
    cache_hit_count: int = 0,
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> dict[str, Any]:
    classified_results = [result for result in results if result.status == "classified"]
    metric_results = [
        result for result in classified_results if result.actual_label in LABELS
    ]
    samples = [
        ClassifiedSample(
            actual_label=result.actual_label,
            raw_prediction=result.raw_prediction or LABEL_NON_BULLYING,
            confidence=result.confidence or 0.0,
        )
        for result in metric_results
    ]
    metrics = calculate_metrics(samples, threshold)
    sweep = threshold_metrics(samples, THRESHOLDS)
    source_counts = {
        label: sum(1 for source in sources if source.label == label)
        for label in LABELS
    }
    segment_counts = {
        label: sum(1 for segment in segments if segment.resolved_label == label)
        for label in (*LABELS, LABEL_UNCERTAIN)
    }
    label_source_counts = {
        source: sum(
            1 for segment in segments if segment.actual_label_source == source
        )
        for source in {segment.actual_label_source for segment in segments}
    }
    manual_label_count = label_source_counts.get("manual", 0)
    uncertain_label_count = segment_counts[LABEL_UNCERTAIN]
    errors = [result.as_dict() for result in results if result.status == "error"]
    errors.extend(issue.as_dict() for issue in scan_issues)
    completed_at = completed_at or datetime.now(UTC)
    started_at = started_at or completed_at
    return {
        "schemaVersion": DATASET_SCHEMA_VERSION,
        "runId": run_id,
        "generatedAt": completed_at.isoformat(),
        "startedAt": started_at.isoformat(),
        "completedAt": completed_at.isoformat(),
        "datasetDirectory": str(dataset_dir),
        "model": settings.gemini_model_name,
        "promptHash": prompt_hash(),
        "videoFps": settings.gemini_video_fps,
        "clipSeconds": clip_seconds,
        "threshold": threshold,
        "requestCount": request_count,
        "cacheHitCount": cache_hit_count,
        "sourceCount": len(sources),
        "sourceCountByLabel": source_counts,
        "segmentCount": len(segments),
        "segmentCountByLabel": segment_counts,
        "actualLabelSourceCounts": label_source_counts,
        "manualLabelCount": manual_label_count,
        "manualLabelCoverage": (
            manual_label_count / len(segments) if segments else 0.0
        ),
        "uncertainLabelCount": uncertain_label_count,
        "metricSampleCount": len(metric_results),
        "classifiedCount": len(classified_results),
        "failedCount": len(errors),
        "processingCoverage": (
            len(classified_results) / len(segments) if segments else 0.0
        ),
        "evaluationCoverage": (
            len(metric_results) / len(segments) if segments else 0.0
        ),
        "metrics": metrics.as_dict(),
        "confusionMatrix": {
            "TP": metrics.true_positive,
            "TN": metrics.true_negative,
            "FP": metrics.false_positive,
            "FN": metrics.false_negative,
        },
        "thresholdSweep": [item.as_dict() for item in sweep],
        "warnings": dataset_warnings(
            source_counts,
            uncertain_label_count=uncertain_label_count,
        ),
        "errors": errors,
    }


def limit_segments(
    segments: list[SegmentSpec],
    limit_per_label: int | None,
) -> list[SegmentSpec]:
    if limit_per_label is None:
        return segments
    if limit_per_label < 1:
        raise DatasetRunnerError("limit_per_label minimal bernilai 1.")
    return [
        segment
        for label in LABELS
        for segment in [
            item for item in segments if item.resolved_label == label
        ][:limit_per_label]
    ]


def sources_for_segments(
    sources: list[DatasetSource],
    segments: list[SegmentSpec],
) -> list[DatasetSource]:
    selected = {
        (segment.source.label, segment.source.relative_path)
        for segment in segments
    }
    return [
        source
        for source in sources
        if (source.label, source.relative_path) in selected
    ]


def dataset_warnings(
    source_counts: dict[str, int],
    *,
    uncertain_label_count: int = 0,
) -> list[str]:
    warnings: list[str] = []
    if source_counts.get(LABEL_NON_BULLYING, 0) < 2:
        warnings.append(
            "Seluruh video non-bullying berasal dari kurang dari dua sumber independen; "
            "metrik belum representatif untuk production."
        )
    if source_counts.get(LABEL_BULLYING, 0) == 0:
        warnings.append("Dataset tidak memiliki video bullying yang valid.")
    if source_counts.get(LABEL_NON_BULLYING, 0) == 0:
        warnings.append("Dataset tidak memiliki video non-bullying yang valid.")
    if uncertain_label_count:
        warnings.append(
            f"{uncertain_label_count} segmen berlabel uncertain dikeluarkan dari metrik."
        )
    return warnings


def prepare_run_dir(
    output_dir: Path,
    *,
    run_id: str | None,
    resume: bool,
) -> Path:
    runs_dir = output_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    generated_run_dir = runs_dir / (
        f"run-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S-%fZ')}"
    )
    if run_id is not None:
        _validate_run_id(run_id)
        run_dir = runs_dir / run_id
    elif resume:
        incomplete = sorted(
            path
            for path in runs_dir.iterdir()
            if path.is_dir() and _is_incomplete_run(path)
        )
        run_dir = incomplete[-1] if incomplete else generated_run_dir
    else:
        run_dir = generated_run_dir

    if run_dir.exists() and not resume and any(run_dir.iterdir()):
        raise DatasetRunnerError(
            f"Run sudah ada: {run_dir}. Gunakan --resume atau --run-id baru."
        )
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def load_cached_results(path: Path) -> dict[str, EvaluationResult]:
    if not path.is_file():
        return {}
    cached: dict[str, EvaluationResult] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
            result = EvaluationResult.from_dict(value)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            continue
        if result.status == "classified":
            cached[result.cache_key] = result
    return cached


def append_jsonl(path: Path, value: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(value, ensure_ascii=False) + "\n")


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_manifest(
    path: Path,
    value: dict[str, Any],
    *,
    merge_existing: bool = False,
) -> None:
    if merge_existing and path.is_file():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}
        existing.update(value)
        value = existing
    write_json(path, value)


def write_results_csv(
    path: Path,
    results: Iterable[EvaluationResult],
    threshold: float,
) -> None:
    fields = [
        "sample_id",
        "actual_label",
        "actual_label_source",
        "annotation_id",
        "annotation_notes",
        "predicted_label",
        "raw_prediction",
        "confidence",
        "source_path",
        "segment_index",
        "start_seconds",
        "duration_seconds",
        "status",
        "gemini_requested",
        "reason",
        "observations",
        "contact_analysis",
        "error",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for result in results:
            predicted = ""
            if result.status == "classified":
                predicted = predicted_label(
                    ClassifiedSample(
                        actual_label=result.actual_label,
                        raw_prediction=result.raw_prediction or LABEL_NON_BULLYING,
                        confidence=result.confidence or 0.0,
                    ),
                    threshold,
                )
            writer.writerow(
                {
                    "sample_id": result.sample_id,
                    "actual_label": result.actual_label,
                    "actual_label_source": result.actual_label_source,
                    "annotation_id": result.annotation_id or "",
                    "annotation_notes": result.annotation_notes or "",
                    "predicted_label": predicted,
                    "raw_prediction": result.raw_prediction or "",
                    "confidence": result.confidence,
                    "source_path": result.source_path,
                    "segment_index": result.segment_index,
                    "start_seconds": f"{result.start_seconds:.3f}",
                    "duration_seconds": f"{result.duration_seconds:.3f}",
                    "status": result.status,
                    "gemini_requested": result.gemini_requested,
                    "reason": result.reason or "",
                    "observations": result.observations or "",
                    "contact_analysis": result.contact_analysis or "",
                    "error": result.error or "",
                }
            )


def render_report(
    summary: dict[str, Any],
    results: list[EvaluationResult],
    threshold: float,
) -> str:
    metrics = summary["metrics"]
    lines = [
        f"# Gemini Dataset Evaluation `{safe(summary['runId'])}`",
        "",
        f"- Model: `{safe(summary['model'])}`",
        f"- Prompt hash: `{safe(summary['promptHash'])}`",
        f"- Video FPS: `{summary['videoFps']}`",
        f"- Clip duration: `{summary['clipSeconds']} detik`",
        f"- Threshold: `{threshold}`",
        f"- Gemini requests: `{summary['requestCount']}`",
        f"- Cache hits: `{summary['cacheHitCount']}`",
        f"- Started: `{safe(summary['startedAt'])}`",
        f"- Completed: `{safe(summary['completedAt'])}`",
        "",
        "## Dataset",
        "",
        f"- Sumber video: **{summary['sourceCount']}**",
        f"- Segmen evaluasi: **{summary['segmentCount']}**",
        f"- Berhasil diklasifikasikan: **{summary['classifiedCount']}**",
        f"- Sampel dalam metrik: **{summary['metricSampleCount']}**",
        f"- Label manual: **{summary['manualLabelCount']}**",
        f"- Label uncertain: **{summary['uncertainLabelCount']}**",
        f"- Gagal diproses: **{summary['failedCount']}**",
        f"- Processing coverage: **{format_percent(summary['processingCoverage'])}**",
        f"- Evaluation coverage: **{format_percent(summary['evaluationCoverage'])}**",
        "",
        "## Metrics",
        "",
        "| Metric | Nilai |",
        "| --- | ---: |",
        f"| Accuracy | {format_percent(metrics['accuracy'])} |",
        f"| Precision | {format_percent(metrics['precision'])} |",
        f"| Recall | {format_percent(metrics['recall'])} |",
        f"| F1-score | {format_percent(metrics['f1'])} |",
        f"| Specificity | {format_percent(metrics['specificity'])} |",
        "",
        "### Confusion Matrix",
        "",
        "|  | Prediksi bullying | Prediksi non-bullying |",
        "| --- | ---: | ---: |",
        f"| Aktual bullying | {metrics['truePositive']} | {metrics['falseNegative']} |",
        f"| Aktual non-bullying | {metrics['falsePositive']} | {metrics['trueNegative']} |",
        "",
        "## Threshold Sweep",
        "",
        "| Threshold | Accuracy | Precision | Recall | F1 | Specificity |",
        "| ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in summary["thresholdSweep"]:
        lines.append(
            f"| {item['threshold']:.2f} | {format_percent(item['accuracy'])} | "
            f"{format_percent(item['precision'])} | {format_percent(item['recall'])} | "
            f"{format_percent(item['f1'])} | {format_percent(item['specificity'])} |"
        )

    warnings = summary.get("warnings", [])
    if warnings:
        lines.extend(["", "## Warnings", ""])
        lines.extend(f"- {safe(warning)}" for warning in warnings)

    mismatches = []
    for result in results:
        if result.status == "error" or result.actual_label not in LABELS:
            continue
        sample = ClassifiedSample(
            actual_label=result.actual_label,
            raw_prediction=result.raw_prediction or LABEL_NON_BULLYING,
            confidence=result.confidence or 0.0,
        )
        predicted = predicted_label(sample, threshold)
        if predicted != result.actual_label:
            mismatches.append((result, predicted))

    lines.extend(["", "## False Positive / False Negative", ""])
    if not mismatches:
        lines.append("Tidak ada mismatch pada klip yang berhasil diproses.")
    else:
        lines.extend(
            [
                "| Jenis | File | Segmen | Confidence | Reason |",
                "| --- | --- | ---: | ---: | --- |",
            ]
        )
        for result, predicted in mismatches:
            kind = "False positive" if predicted == LABEL_BULLYING else "False negative"
            lines.append(
                f"| {kind} | {safe(result.source_path)} | {result.segment_index} | "
                f"{result.confidence or 0:.3f} | {safe(result.reason or '-')} |"
            )

    processing_errors = summary.get("errors", [])
    if processing_errors:
        lines.extend(["", "## Processing Errors", ""])
        for error in processing_errors:
            source_path = (
                error.get("sourcePath")
                or error.get("relativePath")
                or "unknown file"
            )
            segment_index = error.get("segmentIndex")
            segment_suffix = (
                f" segmen {segment_index}" if segment_index is not None else ""
            )
            message = error.get("error") or error.get("message") or "unknown error"
            lines.append(
                f"- `{safe(source_path)}`{segment_suffix}: {safe(message)}"
            )
    return "\n".join(lines) + "\n"


def render_latest_summary(summary: dict[str, Any]) -> str:
    metrics = summary["metrics"]
    lines = [
        "# Latest Gemini Evaluation",
        "",
        f"Run: `{safe(summary['runId'])}`  ",
        f"Model: `{safe(summary['model'])}`  ",
        f"Threshold: `{summary['threshold']}`",
        f"Completed: `{safe(summary['completedAt'])}`",
        "",
        f"- Sumber video: **{summary['sourceCount']}**",
        f"- Segmen: **{summary['segmentCount']}**",
        f"- Sampel metrik: **{summary['metricSampleCount']}**",
        f"- Label manual: **{summary['manualLabelCount']}**",
        f"- Label uncertain: **{summary['uncertainLabelCount']}**",
        f"- Processing coverage: **{format_percent(summary['processingCoverage'])}**",
        f"- Evaluation coverage: **{format_percent(summary['evaluationCoverage'])}**",
        f"- Gemini requests: **{summary['requestCount']}**",
        f"- Cache hits: **{summary['cacheHitCount']}**",
        f"- Accuracy: **{format_percent(metrics['accuracy'])}**",
        f"- Precision: **{format_percent(metrics['precision'])}**",
        f"- Recall: **{format_percent(metrics['recall'])}**",
        f"- F1-score: **{format_percent(metrics['f1'])}**",
        "",
        (
            "Detail lengkap tersimpan di folder run lokal dan tidak di-commit karena "
            "berisi nama file serta observasi video."
        ),
    ]
    if summary.get("warnings"):
        lines.extend(["", "## Catatan", ""])
        lines.extend(f"- {safe(warning)}" for warning in summary["warnings"])
    return "\n".join(lines) + "\n"


def dry_run_summary(
    sources: list[DatasetSource],
    issues: list[DatasetIssue],
    *,
    clip_seconds: float,
    limit_per_label: int | None,
    annotations: dict[tuple[str, int], ManualAnnotation] | None = None,
) -> dict[str, Any]:
    segments = [
        segment
        for source in sources
        for segment in build_segments(source, clip_seconds=clip_seconds)
    ]
    if annotations is not None:
        segments = apply_manual_annotations(segments, annotations)
    segments = limit_segments(segments, limit_per_label)
    selected_sources = sources_for_segments(sources, segments)
    return {
        "schemaVersion": DATASET_SCHEMA_VERSION,
        "dryRun": True,
        "sourceCount": len(selected_sources),
        "sourceCountByLabel": {
            label: sum(1 for source in selected_sources if source.label == label)
            for label in LABELS
        },
        "segmentCount": len(segments),
        "segmentCountByLabel": {
            label: sum(1 for segment in segments if segment.resolved_label == label)
            for label in (*LABELS, LABEL_UNCERTAIN)
        },
        "manualLabelCount": sum(
            1 for segment in segments if segment.actual_label_source == "manual"
        ),
        "uncertainLabelCount": sum(
            1 for segment in segments if segment.resolved_label == LABEL_UNCERTAIN
        ),
        "issues": [issue.as_dict() for issue in issues],
    }


def prompt_hash() -> str:
    return hashlib.sha256(CLASSIFICATION_PROMPT.encode("utf-8")).hexdigest()


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _sample_id(
    source: DatasetSource,
    segment_index: int,
    start_seconds: float,
    duration_seconds: float,
) -> str:
    material = f"{source.relative_path}|{segment_index}|{start_seconds:.3f}|{duration_seconds:.3f}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def _is_incomplete_run(path: Path) -> bool:
    manifest = path / "manifest.json"
    if not manifest.is_file():
        return False
    try:
        value = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return value.get("complete") is False


def _validate_run_id(run_id: str) -> None:
    if not run_id or run_id in {".", ".."} or Path(run_id).name != run_id:
        raise DatasetRunnerError("run_id hanya boleh berupa satu nama folder.")


def _optional_string(value: Any) -> str | None:
    return str(value) if value is not None else None


def _optional_float(value: Any) -> float | None:
    return float(value) if value is not None else None


def safe(value: Any) -> str:
    return (
        html.escape(str(value), quote=False)
        .replace("|", "\\|")
        .replace(chr(96), chr(92) + chr(96))
        .replace("\r", " ")
        .replace("\n", " ")
    )


def format_percent(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{float(value) * 100:.2f}%"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluasi dataset Gemini BRAVE AI")
    parser.add_argument("--dataset-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--annotations-file",
        type=Path,
        help="CSV label manual per segmen; label uncertain dikeluarkan dari metrik.",
    )
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--clip-seconds", type=float, default=3.0)
    parser.add_argument("--concurrency", type=int)
    parser.add_argument(
        "--limit-per-label",
        type=int,
        help="Maksimum jumlah klip yang dievaluasi untuk setiap label.",
    )
    parser.add_argument("--run-id")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--ffmpeg", dest="ffmpeg_binary")
    parser.add_argument("--ffprobe", dest="ffprobe_binary", default="ffprobe")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    settings = get_settings()
    dataset_dir = args.dataset_dir or Path(settings.ai_evaluation_dataset_dir)
    output_dir = args.output_dir or Path(settings.ai_evaluation_report_dir)
    configured_annotations = settings.ai_evaluation_annotations_file.strip()
    annotations_file = args.annotations_file or (
        Path(configured_annotations) if configured_annotations else None
    )
    threshold = (
        args.threshold
        if args.threshold is not None
        else settings.ai_evaluation_threshold
    )
    concurrency = (
        args.concurrency
        if args.concurrency is not None
        else settings.ai_evaluation_concurrency
    )

    try:
        if args.dry_run:
            sources, issues = scan_dataset(
                dataset_dir,
                ffprobe_binary=args.ffprobe_binary,
            )
            print(
                json.dumps(
                    dry_run_summary(
                        sources,
                        issues,
                        clip_seconds=args.clip_seconds,
                        limit_per_label=args.limit_per_label,
                        annotations=(
                            load_manual_annotations(annotations_file)
                            if annotations_file is not None
                            else None
                        ),
                    ),
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 0
        if not settings.gemini_api_key:
            parser.error("GEMINI_API_KEY wajib diisi untuk evaluasi non-dry-run.")
        summary = asyncio.run(
            run_evaluation(
                settings,
                dataset_dir=dataset_dir,
                output_dir=output_dir,
                threshold=threshold,
                clip_seconds=args.clip_seconds,
                concurrency=concurrency,
                limit_per_label=args.limit_per_label,
                resume=args.resume,
                run_id=args.run_id,
                annotations_file=annotations_file,
                ffmpeg_binary=args.ffmpeg_binary,
                ffprobe_binary=args.ffprobe_binary,
            )
        )
    except DatasetRunnerError as error:
        parser.error(str(error))
    print(
        f"Evaluation selesai: {summary['classifiedCount']}/{summary['segmentCount']} "
        f"segmen, report: {output_dir / 'latest-summary.md'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
