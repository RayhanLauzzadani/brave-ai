import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.core.config import Settings
from app.evaluation import dataset_runner
from app.evaluation.dataset_runner import (
    DatasetIssue,
    DatasetRunnerError,
    DatasetSource,
    EvaluationResult,
    apply_manual_annotations,
    bind_result_to_segment,
    build_ffmpeg_command,
    build_segments,
    build_summary,
    dry_run_summary,
    load_cached_results,
    load_manual_annotations,
    render_report,
    scan_dataset,
)


def _source(tmp_path: Path, duration: float, label: str = "bullying") -> DatasetSource:
    path = tmp_path / f"{label}-{duration}.mp4"
    path.write_bytes(b"video fixture")
    return DatasetSource(
        label=label,
        path=path,
        relative_path=path.name,
        duration_seconds=duration,
        source_hash=f"hash-{duration}-{label}",
    )


def test_segment_rules_cover_center_padding_and_non_overlapping_windows(tmp_path):
    centered = build_segments(_source(tmp_path, 4.0))
    assert len(centered) == 1
    assert centered[0].start_seconds == pytest.approx(0.5)
    assert centered[0].duration_seconds == 3.0
    assert centered[0].pad_to_duration is False

    long_video = build_segments(_source(tmp_path, 87.0))
    assert len(long_video) == 29
    assert long_video[0].start_seconds == 0
    assert long_video[-1].start_seconds == pytest.approx(84.0)

    short_video = build_segments(_source(tmp_path, 2.5))
    assert len(short_video) == 1
    assert short_video[0].start_seconds == 0
    assert short_video[0].pad_to_duration is True


def test_scanner_accepts_supported_extensions_and_records_invalid_files(
    tmp_path, monkeypatch
):
    (tmp_path / "bullying").mkdir()
    (tmp_path / "non-bullying").mkdir()
    good = tmp_path / "bullying" / "good.MP4"
    broken = tmp_path / "non-bullying" / "broken.mkv"
    ignored = tmp_path / "bullying" / "notes.txt"
    good.write_bytes(b"good")
    broken.write_bytes(b"broken")
    ignored.write_text("ignore", encoding="utf-8")

    def fake_probe(path, _binary):
        if path == broken:
            raise DatasetRunnerError("FFprobe gagal membaca video.")
        return 4.0

    monkeypatch.setattr(dataset_runner, "probe_duration", fake_probe)
    monkeypatch.setattr(dataset_runner, "hash_file", lambda path: "fixture-hash")

    sources, issues = scan_dataset(tmp_path)

    assert [source.relative_path for source in sources] == ["bullying/good.MP4"]
    assert issues[0].relative_path == "non-bullying/broken.mkv"
    assert "FFprobe" in issues[0].message


def test_ffmpeg_command_normalizes_short_clip_with_frame_padding(tmp_path):
    segment = build_segments(_source(tmp_path, 2.0))[0]

    command = build_ffmpeg_command(segment, tmp_path / "normalized.mp4", fps=10)

    joined = " ".join(command)
    assert "-an" in command
    assert "fps=10,scale=640:-2,format=yuv420p,tpad=stop_mode=clone:stop_duration=1.000" in joined
    assert "-t 3.000" in joined


def test_cache_loads_only_successful_classifications(tmp_path):
    source = _source(tmp_path, 4.0)
    segment = build_segments(source)[0]
    classified = EvaluationResult(
        sample_id=segment.sample_id,
        cache_key=segment.cache_key,
        actual_label=source.label,
        source_path=source.relative_path,
        source_duration_seconds=source.duration_seconds,
        segment_index=0,
        start_seconds=segment.start_seconds,
        duration_seconds=3.0,
        status="classified",
        raw_prediction="non-bullying",
        confidence=0.9,
        reason="Kontak fisik terlihat.",
    )
    failed = EvaluationResult(
        sample_id="failed",
        cache_key="failed-key",
        actual_label=source.label,
        source_path=source.relative_path,
        source_duration_seconds=source.duration_seconds,
        segment_index=1,
        start_seconds=3.0,
        duration_seconds=3.0,
        status="error",
        error="temporary failure",
    )
    cache_path = tmp_path / "raw-results.jsonl"
    cache_path.write_text(
        json.dumps(classified.as_dict()) + "\n" + json.dumps(failed.as_dict()),
        encoding="utf-8",
    )

    cached = load_cached_results(cache_path)

    assert list(cached) == [segment.cache_key]
    assert cached[segment.cache_key].confidence == 0.9


def test_report_escapes_classifier_text_and_never_contains_api_key(tmp_path):
    source = _source(tmp_path, 4.0)
    segment = build_segments(source)[0]
    result = EvaluationResult(
        sample_id=segment.sample_id,
        cache_key=segment.cache_key,
        actual_label=source.label,
        source_path=source.relative_path,
        source_duration_seconds=source.duration_seconds,
        segment_index=0,
        start_seconds=segment.start_seconds,
        duration_seconds=3.0,
        status="classified",
        raw_prediction="non-bullying",
        confidence=0.92,
        reason="<script>alert('x')</script> | reason",
        observations="Observed\nline",
    )
    settings = Settings(
        _env_file=None,
        gemini_api_key="PRIVATE-TEST-KEY",
        gemini_model_name="test-model",
        gemini_video_fps=10,
    )
    summary = build_summary(
        run_id="run-test",
        dataset_dir=tmp_path,
        sources=[source],
        segments=[segment],
        results=[result],
        scan_issues=[
            DatasetIssue(
                label="non-bullying",
                relative_path="non-bullying/<broken>.mp4",
                message="File <rusak>",
            )
        ],
        threshold=0.75,
        clip_seconds=3.0,
        settings=settings,
        request_count=1,
    )

    report = render_report(summary, [result], 0.75)

    assert "<script>" not in report
    assert "&lt;script&gt;" in report
    assert "PRIVATE-TEST-KEY" not in report
    assert "\\|" in report
    assert "non-bullying/&lt;broken&gt;.mp4" in report
    assert "File &lt;rusak&gt;" in report
def test_expected_benchmark_shape_is_50_bullying_and_29_non_bullying_clips():
    bullying = [
        DatasetSource(
            label="bullying",
            path=Path(f"bullying/{index}.mp4"),
            relative_path=f"bullying/{index}.mp4",
            duration_seconds=4.0,
            source_hash=f"bullying-{index}",
        )
        for index in range(50)
    ]
    neutral = DatasetSource(
        label="non-bullying",
        path=Path("non-bullying/source.mp4"),
        relative_path="non-bullying/source.mp4",
        duration_seconds=87.0,
        source_hash="neutral-source",
    )

    summary = dry_run_summary(
        bullying + [neutral],
        [],
        clip_seconds=3.0,
        limit_per_label=None,
    )

    assert summary["sourceCountByLabel"] == {"bullying": 50, "non-bullying": 1}
    assert summary["segmentCountByLabel"] == {
        "bullying": 50,
        "non-bullying": 29,
        "uncertain": 0,
    }

    pilot = dry_run_summary(
        bullying + [neutral],
        [],
        clip_seconds=3.0,
        limit_per_label=3,
    )

    assert pilot["sourceCountByLabel"] == {"bullying": 3, "non-bullying": 1}
    assert pilot["segmentCountByLabel"] == {
        "bullying": 3,
        "non-bullying": 3,
        "uncertain": 0,
    }


def test_cache_key_includes_model_and_fps(tmp_path):
    source = _source(tmp_path, 4.0)
    ten_fps = build_segments(
        source,
        model_name="model-a",
        video_fps=10,
    )[0]
    five_fps = build_segments(
        source,
        model_name="model-a",
        video_fps=5,
    )[0]
    other_model = build_segments(
        source,
        model_name="model-b",
        video_fps=10,
    )[0]

    assert ten_fps.cache_key != five_fps.cache_key
    assert ten_fps.cache_key != other_model.cache_key

def test_manual_annotations_override_folder_labels_and_preserve_metadata(tmp_path):
    source = _source(tmp_path, 4.0)
    segment = build_segments(source)[0]
    annotations_path = tmp_path / "annotations.csv"
    annotations_path.write_text(
        "review_id,source_path,segment_index,start_seconds,end_seconds,"
        "manual_label,notes\n"
        f"R001,{source.relative_path},0,{segment.start_seconds},"
        f"{segment.start_seconds + segment.duration_seconds},non-bullying,"
        "Tidak ada kontak agresif\n",
        encoding="utf-8",
    )

    annotations = load_manual_annotations(annotations_path)
    resolved = apply_manual_annotations([segment], annotations)

    assert resolved[0].resolved_label == "non-bullying"
    assert resolved[0].actual_label_source == "manual"
    assert resolved[0].annotation_id == "R001"
    assert resolved[0].annotation_notes == "Tidak ada kontak agresif"


def test_manual_annotations_must_cover_every_segment(tmp_path):
    source = _source(tmp_path, 7.0)
    segments = build_segments(source)
    annotations_path = tmp_path / "annotations.csv"
    annotations_path.write_text(
        "review_id,source_path,segment_index,start_seconds,end_seconds,"
        "manual_label,notes\n"
        f"R001,{source.relative_path},0,0,3,bullying,Kontak agresif\n",
        encoding="utf-8",
    )

    with pytest.raises(DatasetRunnerError, match="tanpa anotasi"):
        apply_manual_annotations(
            segments,
            load_manual_annotations(annotations_path),
        )


def test_cached_result_is_rebound_to_current_manual_label(tmp_path):
    source = _source(tmp_path, 4.0)
    segment = replace(
        build_segments(source)[0],
        actual_label="non-bullying",
        actual_label_source="manual",
        annotation_id="R010",
        annotation_notes="Aktivitas netral",
    )
    cached = EvaluationResult(
        sample_id="old-sample",
        cache_key=segment.cache_key,
        actual_label="bullying",
        source_path=source.relative_path,
        source_duration_seconds=source.duration_seconds,
        segment_index=0,
        start_seconds=segment.start_seconds,
        duration_seconds=segment.duration_seconds,
        status="classified",
        raw_prediction="bullying",
        confidence=0.88,
    )

    rebound = bind_result_to_segment(cached, segment)

    assert rebound.actual_label == "non-bullying"
    assert rebound.actual_label_source == "manual"
    assert rebound.annotation_id == "R010"
    assert rebound.raw_prediction == "bullying"
    assert rebound.confidence == 0.88


def test_summary_excludes_uncertain_labels_from_metrics(tmp_path):
    labels = ["bullying", "non-bullying", "uncertain"]
    sources = [
        _source(tmp_path, 4.0 + index / 10)
        for index in range(len(labels))
    ]
    segments = [
        replace(
            build_segments(source)[0],
            actual_label=label,
            actual_label_source="manual",
            annotation_id=f"R{index + 1:03d}",
        )
        for index, (source, label) in enumerate(zip(sources, labels, strict=True))
    ]
    predictions = ["bullying", "non-bullying", "bullying"]
    results = [
        EvaluationResult(
            sample_id=segment.sample_id,
            cache_key=segment.cache_key,
            actual_label=segment.resolved_label,
            actual_label_source=segment.actual_label_source,
            annotation_id=segment.annotation_id,
            source_path=segment.source.relative_path,
            source_duration_seconds=segment.source.duration_seconds,
            segment_index=segment.segment_index,
            start_seconds=segment.start_seconds,
            duration_seconds=segment.duration_seconds,
            status="classified",
            raw_prediction=prediction,
            confidence=0.9,
        )
        for segment, prediction in zip(segments, predictions, strict=True)
    ]
    settings = Settings(
        _env_file=None,
        gemini_api_key="test-key",
        gemini_model_name="test-model",
        gemini_video_fps=10,
    )

    summary = build_summary(
        run_id="manual-label-test",
        dataset_dir=tmp_path,
        sources=sources,
        segments=segments,
        results=results,
        scan_issues=[],
        threshold=0.75,
        clip_seconds=3.0,
        settings=settings,
    )

    assert summary["classifiedCount"] == 3
    assert summary["metricSampleCount"] == 2
    assert summary["uncertainLabelCount"] == 1
    assert summary["manualLabelCount"] == 3
    assert summary["manualLabelCoverage"] == 1.0
    assert summary["processingCoverage"] == 1.0
    assert summary["evaluationCoverage"] == pytest.approx(2 / 3)
    assert summary["metrics"]["total"] == 2
    assert summary["metrics"]["accuracy"] == 1.0
    assert any("uncertain" in warning for warning in summary["warnings"])
