import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.evaluation import dataset_runner
from app.evaluation.dataset_runner import (
    DatasetRunnerError,
    DatasetSource,
    run_evaluation,
)
from app.services.gemini_classifier import GeminiClassification


def _source(tmp_path: Path) -> DatasetSource:
    path = tmp_path / "bullying" / "sample.mp4"
    path.parent.mkdir()
    path.write_bytes(b"source")
    return DatasetSource(
        label="bullying",
        path=path,
        relative_path="bullying/sample.mp4",
        duration_seconds=4.0,
        source_hash="source-hash",
    )


def test_probe_rejects_file_without_video_stream(tmp_path, monkeypatch):
    path = tmp_path / "audio-only.mp4"
    path.write_bytes(b"audio")

    def fake_run(*_args, **_kwargs):
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps(
                {
                    "format": {"duration": "4.0"},
                    "streams": [{"codec_type": "audio"}],
                }
            ),
            stderr="",
        )

    monkeypatch.setattr(dataset_runner.subprocess, "run", fake_run)

    with pytest.raises(DatasetRunnerError, match="stream video"):
        dataset_runner.probe_duration(path)


def test_resume_does_not_reclassify_successful_segment(tmp_path, monkeypatch):
    source = _source(tmp_path)
    monkeypatch.setattr(
        dataset_runner,
        "scan_dataset",
        lambda _directory, ffprobe_binary: ([source], []),
    )

    def fake_normalize(segment, output_path, **_kwargs):
        output_path.write_bytes(b"normalized-video" * 200)

    monkeypatch.setattr(dataset_runner, "normalize_segment", fake_normalize)
    calls = 0

    class FakeClassifier:
        def __init__(self, settings, client):
            self.settings = settings
            self.client = client

        async def classify(self, _video_bytes, **_kwargs):
            nonlocal calls
            calls += 1
            return GeminiClassification(
                ruangan_kosong=False,
                jumlah_subjek=2,
                ada_kontak_antar_subjek=True,
                kronologi_kejadian="Ada dorongan dan reaksi korban.",
                detik_mulai_kontak=1.0,
                confidence=0.9,
                prediction="bullying",
                reason="Dorongan sepihak.",
            )

    monkeypatch.setattr(dataset_runner, "GeminiVideoClassifier", FakeClassifier)
    settings = Settings(
        _env_file=None,
        gemini_api_key="test-key",
        gemini_video_fps=10,
        gemini_inline_max_bytes=1024 * 1024,
    )
    output_dir = tmp_path / "reports"

    first = asyncio.run(
        run_evaluation(
            settings,
            dataset_dir=tmp_path,
            output_dir=output_dir,
            threshold=0.75,
            clip_seconds=3.0,
            concurrency=1,
            run_id="resume-test",
        )
    )
    second = asyncio.run(
        run_evaluation(
            settings,
            dataset_dir=tmp_path,
            output_dir=output_dir,
            threshold=0.75,
            clip_seconds=3.0,
            concurrency=1,
            run_id="resume-test",
            resume=True,
        )
    )

    assert calls == 1
    assert first["requestCount"] == 1
    assert second["requestCount"] == 0
    assert second["cacheHitCount"] == 1
    assert (output_dir / "runs" / "resume-test" / "summary.json").is_file()

def test_normalization_failure_is_not_counted_as_gemini_request(
    tmp_path, monkeypatch
):
    source = _source(tmp_path)
    monkeypatch.setattr(
        dataset_runner,
        "scan_dataset",
        lambda _directory, ffprobe_binary: ([source], []),
    )

    def fail_normalize(_segment, _output_path, **_kwargs):
        raise DatasetRunnerError("normalization failed")

    monkeypatch.setattr(dataset_runner, "normalize_segment", fail_normalize)

    class UnexpectedClassifier:
        def __init__(self, settings, client):
            self.settings = settings
            self.client = client

        async def classify(self, _video_bytes, **_kwargs):
            raise AssertionError("classifier should not be called")

    monkeypatch.setattr(
        dataset_runner,
        "GeminiVideoClassifier",
        UnexpectedClassifier,
    )
    settings = Settings(_env_file=None, gemini_api_key="test-key")

    summary = asyncio.run(
        run_evaluation(
            settings,
            dataset_dir=tmp_path,
            output_dir=tmp_path / "reports",
            threshold=0.75,
            clip_seconds=3.0,
            concurrency=1,
            run_id="normalization-error",
        )
    )

    assert summary["requestCount"] == 0
    assert summary["failedCount"] == 1
