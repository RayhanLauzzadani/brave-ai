from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

LABEL_BULLYING = "bullying"
LABEL_NON_BULLYING = "non-bullying"


@dataclass(frozen=True)
class ClassifiedSample:
    """The fields needed to score one successfully classified segment."""

    actual_label: str
    raw_prediction: str
    confidence: float


@dataclass(frozen=True)
class ClassificationMetrics:
    total: int
    threshold: float
    true_positive: int
    true_negative: int
    false_positive: int
    false_negative: int
    accuracy: float | None
    precision: float | None
    recall: float | None
    f1: float | None
    specificity: float | None

    def as_dict(self) -> dict[str, int | float | None]:
        return {
            "total": self.total,
            "threshold": self.threshold,
            "truePositive": self.true_positive,
            "trueNegative": self.true_negative,
            "falsePositive": self.false_positive,
            "falseNegative": self.false_negative,
            "accuracy": self.accuracy,
            "precision": self.precision,
            "recall": self.recall,
            "f1": self.f1,
            "specificity": self.specificity,
        }


def predicted_label(sample: ClassifiedSample, threshold: float) -> str:
    if (
        sample.raw_prediction == LABEL_BULLYING
        and sample.confidence >= threshold
    ):
        return LABEL_BULLYING
    return LABEL_NON_BULLYING


def calculate_metrics(
    samples: Iterable[ClassifiedSample],
    threshold: float,
) -> ClassificationMetrics:
    true_positive = 0
    true_negative = 0
    false_positive = 0
    false_negative = 0

    for sample in samples:
        actual_bullying = sample.actual_label == LABEL_BULLYING
        predicted_bullying = predicted_label(sample, threshold) == LABEL_BULLYING
        if actual_bullying and predicted_bullying:
            true_positive += 1
        elif not actual_bullying and not predicted_bullying:
            true_negative += 1
        elif not actual_bullying and predicted_bullying:
            false_positive += 1
        else:
            false_negative += 1

    total = true_positive + true_negative + false_positive + false_negative
    accuracy = _ratio(true_positive + true_negative, total)
    precision = _ratio(true_positive, true_positive + false_positive)
    recall = _ratio(true_positive, true_positive + false_negative)
    specificity = _ratio(true_negative, true_negative + false_positive)
    if precision is None or recall is None:
        f1 = None
    elif precision + recall == 0:
        f1 = 0.0
    else:
        f1 = 2 * precision * recall / (precision + recall)

    return ClassificationMetrics(
        total=total,
        threshold=threshold,
        true_positive=true_positive,
        true_negative=true_negative,
        false_positive=false_positive,
        false_negative=false_negative,
        accuracy=accuracy,
        precision=precision,
        recall=recall,
        f1=f1,
        specificity=specificity,
    )


def threshold_metrics(
    samples: Iterable[ClassifiedSample],
    thresholds: Iterable[float],
) -> list[ClassificationMetrics]:
    materialized = list(samples)
    return [calculate_metrics(materialized, threshold) for threshold in thresholds]


def _ratio(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator
