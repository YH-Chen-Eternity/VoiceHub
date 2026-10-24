from aggregator import aggregate, map_risk_to_status
from config import STATUS_API_UNAVAILABLE, STATUS_MANUAL_REVIEW, STATUS_PASS


def img(risk, labels=None):
    return {"risk_level": risk, "labels": labels or []}


def test_mapping_is_strict():
    assert map_risk_to_status("none") == STATUS_PASS
    assert map_risk_to_status("low") == STATUS_PASS
    assert map_risk_to_status("medium") == STATUS_MANUAL_REVIEW
    assert map_risk_to_status("high") == STATUS_MANUAL_REVIEW
    assert map_risk_to_status("unknown") == STATUS_MANUAL_REVIEW
    assert map_risk_to_status(None) == STATUS_MANUAL_REVIEW


def test_all_low_or_none_pass():
    result = aggregate([img("none"), img("low"), img("low")], [])
    assert result["overall_status"] == STATUS_PASS


def test_any_medium_or_high_manual():
    assert aggregate([img("low"), img("medium")], [])["overall_status"] == (
        STATUS_MANUAL_REVIEW
    )
    assert aggregate([img("low"), img("high")], [])["overall_status"] == (
        STATUS_MANUAL_REVIEW
    )


def test_any_failure_manual():
    result = aggregate(
        [img("low")], [{"task_id": "p_1", "reason": "timeout"}]
    )
    assert result["overall_status"] == STATUS_MANUAL_REVIEW


def test_empty_images_manual():
    assert aggregate([], [], total_images=0)["overall_status"] == (
        STATUS_MANUAL_REVIEW
    )


def test_rule_intercepted_manual():
    result = aggregate([], [], rule_intercepted=True, total_images=9)
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
    assert result["rule_intercepted"] is True


def test_api_unavailable():
    result = aggregate([img("low")], [], api_unavailable=True)
    assert result["overall_status"] == STATUS_API_UNAVAILABLE


def test_forced_labels_manual_even_if_medium():
    result = aggregate([img("medium", ["学生欺凌"])], [])
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
    result = aggregate([img("low", ["恶意丑化"])], [])
    assert result["overall_status"] == STATUS_MANUAL_REVIEW


def test_unknown_risk_manual():
    result = aggregate([img("mystery")], [])
    assert result["overall_status"] == STATUS_MANUAL_REVIEW


def test_failure_wins_over_pass():
    result = aggregate(
        [img("none"), img("low")],
        [{"task_id": "p_2", "reason": "HTTP 500"}],
        total_images=3,
    )
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
