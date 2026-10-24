"""九宫格结果聚合。

【业务硬约束 · 不可随意修改】
- 任意一张图片 medium/high -> 整组 MANUAL_REVIEW
- 任意一张图片 failed    -> 整组 MANUAL_REVIEW（无法确认安全）
- 全部 none/low 且无失败   -> 整组 PASS
- 空图片列表或全部 URL 非法 -> 整组 MANUAL_REVIEW（保守策略）
- 前置规则命中 / 标准审核判黑 -> 整组 MANUAL_REVIEW
- API 不可用 -> 整组 API_UNAVAILABLE
- “恶意丑化”“学生欺凌”标签 -> 强制 MANUAL_REVIEW（即使风险等级为 medium/low）
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence

from config import (
    FORCE_MANUAL_REVIEW_LABELS,
    RISK_MAPPING,
    STATUS_API_UNAVAILABLE,
    STATUS_MANUAL_REVIEW,
    STATUS_PASS,
)


def map_risk_to_status(risk_level: Optional[str]) -> str:
    """按硬约束映射风险等级；未知等级一律转人工。"""
    key = (risk_level or "").strip().lower()
    return RISK_MAPPING.get(key, STATUS_MANUAL_REVIEW)


def _has_forced_label(labels: Iterable[str]) -> bool:
    for label in labels or []:
        text = str(label or "")
        for forced in FORCE_MANUAL_REVIEW_LABELS:
            if forced in text:
                return True
    return False


def aggregate(
    per_image_results: Sequence[Dict[str, Any]],
    failed_images: Sequence[Dict[str, Any]],
    rule_intercepted: bool = False,
    api_unavailable: bool = False,
    total_images: Optional[int] = None,
) -> Dict[str, Any]:
    """聚合多张图片的审核结果。

    参数：
        per_image_results: 每张成功审核图片的 dict，需包含 risk_level、labels。
        failed_images: 审核失败的图片列表（含 task_id / reason）。
        rule_intercepted: 是否被前置规则或标准审核拦截。
        api_unavailable: 是否处于 DEGRADED（API 不可用）。
        total_images: 原始提交的图片数量，用于识别空列表。
    返回：
        {"overall_status": ..., "reason": ..., "per_image_results": ..., ...}
    """
    results = list(per_image_results or [])
    failed = list(failed_images or [])
    image_count = total_images if total_images is not None else len(results) + len(failed)

    base = {
        "per_image_results": results,
        "failed_images": failed,
        "rule_intercepted": bool(rule_intercepted),
    }

    # 1) API 不可用：直接进入人工队列，不再做风险推断。
    if api_unavailable:
        return dict(
            base,
            overall_status=STATUS_API_UNAVAILABLE,
            reason="审核 API 不可用，转人工队列",
        )

    # 2) 前置规则/标准审核命中：整组人工。
    if rule_intercepted:
        return dict(
            base,
            overall_status=STATUS_MANUAL_REVIEW,
            reason="前置规则命中，整组转人工",
        )

    # 3) 空图片列表：保守转人工。
    if image_count <= 0:
        return dict(
            base,
            overall_status=STATUS_MANUAL_REVIEW,
            reason="空图片列表，保守转人工",
        )

    # 4) 任意图片失败：无法确认安全，整组人工。
    if failed:
        return dict(
            base,
            overall_status=STATUS_MANUAL_REVIEW,
            reason="存在审核失败图片，整组转人工",
        )

    # 5) 逐张映射；未知风险等级按人工处理。
    manual_reasons: List[str] = []
    for item in results:
        risk = str(item.get("risk_level") or "").lower()
        labels = item.get("labels") or []
        if _has_forced_label(labels):
            manual_reasons.append(
                "命中强制人工标签：%s" % "、".join(str(x) for x in labels)
            )
            continue
        if risk not in RISK_MAPPING:
            manual_reasons.append("未知风险等级：%s" % (risk or "empty"))
            continue
        if map_risk_to_status(risk) == STATUS_MANUAL_REVIEW:
            manual_reasons.append("图片风险等级 %s" % risk)

    if manual_reasons:
        return dict(
            base,
            overall_status=STATUS_MANUAL_REVIEW,
            reason="；".join(dict.fromkeys(manual_reasons)),
        )

    return dict(base, overall_status=STATUS_PASS, reason="全部图片为低风险")
