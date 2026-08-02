from app.evaluation.metrics import (
    LABEL_BULLYING,
    LABEL_NON_BULLYING,
    ClassifiedSample,
    calculate_metrics,
    predicted_label,
    threshold_metrics,
)


def test_metrics_counts_confusion_matrix_and_scores():
    samples = [
        ClassifiedSample(LABEL_BULLYING, "bullying", 0.90),
        ClassifiedSample(LABEL_NON_BULLYING, "non-bullying", 0.90),
        ClassifiedSample(LABEL_NON_BULLYING, "bullying", 0.90),
        ClassifiedSample(LABEL_BULLYING, "bullying", 0.50),
    ]

    metrics = calculate_metrics(samples, threshold=0.75)

    assert metrics.true_positive == 1
    assert metrics.true_negative == 1
    assert metrics.false_positive == 1
    assert metrics.false_negative == 1
    assert metrics.accuracy == 0.5
    assert metrics.precision == 0.5
    assert metrics.recall == 0.5
    assert metrics.f1 == 0.5
    assert metrics.specificity == 0.5


def test_threshold_is_applied_to_bullying_prediction():
    sample = ClassifiedSample(LABEL_BULLYING, "bullying", 0.74)

    assert predicted_label(sample, 0.75) == LABEL_NON_BULLYING
    assert predicted_label(sample, 0.70) == LABEL_BULLYING


def test_threshold_sweep_reuses_materialized_samples():
    samples = [
        ClassifiedSample(LABEL_BULLYING, "bullying", 0.80),
        ClassifiedSample(LABEL_NON_BULLYING, "non-bullying", 0.80),
    ]

    sweep = threshold_metrics(samples, [0.50, 0.85])

    assert [item.threshold for item in sweep] == [0.50, 0.85]
    assert sweep[0].true_positive == 1
    assert sweep[1].false_negative == 1

def test_f1_is_zero_when_precision_and_recall_are_both_zero():
    samples = [
        ClassifiedSample(LABEL_BULLYING, "non-bullying", 0.90),
        ClassifiedSample(LABEL_NON_BULLYING, "bullying", 0.90),
    ]

    metrics = calculate_metrics(samples, threshold=0.75)

    assert metrics.precision == 0.0
    assert metrics.recall == 0.0
    assert metrics.f1 == 0.0