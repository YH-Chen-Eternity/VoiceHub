"""九宫格图文拆分、任务提交与结果聚合。"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from aggregator import aggregate, map_risk_to_status
from config import (
    MODE_DEGRADED,
    STATUS_API_UNAVAILABLE,
    STATUS_MANUAL_REVIEW,
    Settings,
)
from moderation_client import ERR_API_UNAVAILABLE, ApiResult, ModerationClient
from prefilter import is_risky_text, prefilter_with_standard
from queue_worker import AuditTask, QueueWorker, TaskOutcome
from security import redact_url, validate_image_url_resolved

logger = logging.getLogger("moderation.pipeline")


class AuditRequestError(ValueError):
    """请求参数不合法（应由接口层转换为 400）。"""


class AuditPipeline:
    """把一次帖子审核拆成 1~9 个单图任务并聚合。"""

    def __init__(
        self, client: ModerationClient, worker: QueueWorker, settings: Settings
    ) -> None:
        self.client = client
        self.worker = worker
        self.settings = settings

    async def audit(
        self, post_id: str, text: str, image_urls: Sequence[str]
    ) -> Dict[str, Any]:
        """执行一次完整审核。

        异常：
            AuditRequestError: 图片数量超过 9 张等非法请求。
        """
        started = time.monotonic()
        post_id = (post_id or "").strip()
        if not post_id:
            raise AuditRequestError("post_id 不能为空")
        if len(post_id) > 128:
            raise AuditRequestError("post_id 长度不能超过 128")

        raw_text = text or ""
        truncated = len(raw_text) > self.settings.max_text_chars
        safe_text = raw_text[: self.settings.max_text_chars]

        urls = [str(url).strip() for url in (image_urls or [])]
        if len(urls) > self.settings.max_images:
            raise AuditRequestError(
                "image_urls 最多 %d 张" % self.settings.max_images
            )

        # 【业务硬约束】空图片列表直接人工复核，不调用 API。
        if not urls:
            return self._response(
                post_id=post_id,
                aggregation=aggregate([], [], total_images=0),
                started=started,
                mode_label=(
                    MODE_DEGRADED if self.client.mode == MODE_DEGRADED else self.client.mode
                ),
                text_truncated=truncated,
                image_count=0,
                request_mode="none",
            )

        # 【业务硬约束 · API 不可用降级】DEGRADED 下不发起任何外部调用。
        if self.client.mode == MODE_DEGRADED:
            return self._response(
                post_id=post_id,
                aggregation=self._unavailable_aggregation(urls),
                started=started,
                mode_label=MODE_DEGRADED,
                text_truncated=truncated,
                image_count=len(urls),
                request_mode="none",
            )

        # 前置正则 + 可选标准审核；命中即整组人工，不调用智能体。
        prefilter_result = await prefilter_with_standard(
            self.client, safe_text, urls
        )
        if self.client.mode == MODE_DEGRADED:
            return self._response(
                post_id=post_id,
                aggregation=self._unavailable_aggregation(urls),
                started=started,
                mode_label=MODE_DEGRADED,
                text_truncated=truncated,
                image_count=len(urls),
                request_mode="none",
            )

        if prefilter_result.intercepted:
            logger.warning(
                "前置规则拦截 post=%s rule=%s", post_id, prefilter_result.matched_rule
            )
            return self._response(
                post_id=post_id,
                aggregation=aggregate(
                    [], [], rule_intercepted=True, total_images=len(urls)
                ),
                started=started,
                mode_label=self.client.mode,
                text_truncated=truncated,
                image_count=len(urls),
                request_mode="none",
                extra={
                    "prefilter_rule": prefilter_result.matched_rule,
                    "prefilter_labels": prefilter_result.standard_labels,
                },
                rule_reason=prefilter_result.reason,
            )

        # URL 基础校验（含 DNS 解析，防 SSRF）；非法图片单独记为 failed。
        valid: List[Tuple[int, str]] = []
        failed_images: List[Dict[str, Any]] = []
        for index, url in enumerate(urls):
            ok, reason = await validate_image_url_resolved(
                url,
                allow_private=self.settings.allow_private_image_urls,
                timeout_seconds=self.settings.image_fetch_timeout_seconds,
            )
            if not ok:
                failed_images.append(
                    {
                        "task_id": "%s_%d" % (post_id, index),
                        "index": index,
                        "image_url": redact_url(url),
                        "reason": reason,
                        "error_type": "invalid_url",
                    }
                )
            else:
                valid.append((index, url))

        # 全部 URL 非法：保守转人工，不调用 API。
        if not valid:
            return self._response(
                post_id=post_id,
                aggregation=aggregate(
                    [], failed_images, total_images=len(urls)
                ),
                started=started,
                mode_label=self.client.mode,
                text_truncated=truncated,
                image_count=len(urls),
                request_mode="none",
            )

        # 九宫格拆分：可疑配文才附带文本，避免 9 倍文本计费。
        multimodal = bool(safe_text.strip()) and is_risky_text(safe_text)
        app_id = (
            self.settings.multimodal_app_id
            if multimodal
            else self.settings.image_app_id
        )
        task_text: Optional[str] = safe_text if multimodal else None

        loop = asyncio.get_running_loop()
        futures: List[asyncio.Future] = []
        pending_meta: Dict[asyncio.Future, Dict[str, Any]] = {}

        for index, url in valid:
            task_id = "%s_%d" % (post_id, index)
            future: asyncio.Future = loop.create_future()
            task = AuditTask(
                task_id=task_id,
                post_id=post_id,
                image_url=url,
                text=task_text,
                app_id=app_id,
                deadline=0.0,  # 由 worker 在出队时设置为当前时间 + 单任务超时
                future=future,
            )
            meta = {"index": index, "url": url, "task_id": task_id}
            if not self.worker.submit(task):
                future.set_result(
                    TaskOutcome(
                        task_id=task_id,
                        ok=False,
                        error="审核队列已满，请稍后重试",
                        error_type="queue_full",
                    )
                )
            futures.append(future)
            pending_meta[future] = meta

        remaining = self.settings.audit_timeout_seconds - (
            time.monotonic() - started
        )
        if futures:
            _, pending = await asyncio.wait(
                futures, timeout=max(0.1, remaining)
            )
            for future in pending:
                future.cancel()

        per_image_results: List[Dict[str, Any]] = []
        api_unavailable = self.client.mode == MODE_DEGRADED
        for future in futures:
            meta = pending_meta[future]
            if future.cancelled():
                failed_images.append(
                    {
                        "task_id": meta["task_id"],
                        "index": meta["index"],
                        "image_url": redact_url(meta["url"]),
                        "reason": "审核超时（超过 %.0f 秒）"
                        % self.settings.audit_timeout_seconds,
                        "error_type": "audit_timeout",
                    }
                )
                continue
            outcome: TaskOutcome = future.result()
            if outcome.error_type == ERR_API_UNAVAILABLE:
                api_unavailable = True
            if not outcome.ok:
                failed_images.append(
                    {
                        "task_id": meta["task_id"],
                        "index": meta["index"],
                        "image_url": redact_url(meta["url"]),
                        "reason": outcome.error or "审核失败",
                        "error_type": outcome.error_type or "failed",
                    }
                )
                continue
            result: Optional[ApiResult] = outcome.result
            if result is None:
                failed_images.append(
                    {
                        "task_id": meta["task_id"],
                        "index": meta["index"],
                        "image_url": redact_url(meta["url"]),
                        "reason": "审核结果为空",
                        "error_type": "empty_result",
                    }
                )
                continue
            per_image_results.append(
                {
                    "task_id": meta["task_id"],
                    "index": meta["index"],
                    "image_url": redact_url(meta["url"]),
                    "risk_level": result.risk_level,
                    "decision": map_risk_to_status(result.risk_level),
                    "labels": result.labels,
                    "descriptions": result.descriptions,
                    "request_id": result.request_id,
                    "code": result.code,
                    "endpoint": result.endpoint,
                }
            )

        failed_images.sort(key=lambda item: item["index"])
        per_image_results.sort(key=lambda item: item["index"])

        aggregation = aggregate(
            per_image_results,
            failed_images,
            api_unavailable=api_unavailable,
            total_images=len(urls),
        )
        return self._response(
            post_id=post_id,
            aggregation=aggregation,
            started=started,
            mode_label=self.client.mode,
            text_truncated=truncated,
            image_count=len(urls),
            request_mode="multimodal" if multimodal else "image_only",
            extra={"app_id": app_id},
        )

    # ------------------------------------------------------------------
    # 辅助
    # ------------------------------------------------------------------
    @staticmethod
    def _unavailable_aggregation(urls: Sequence[str]) -> Dict[str, Any]:
        return {
            "overall_status": STATUS_API_UNAVAILABLE,
            "reason": "审核 API 不可用，转人工队列",
            "per_image_results": [],
            "failed_images": [],
            "rule_intercepted": False,
        }

    def _response(
        self,
        *,
        post_id: str,
        aggregation: Dict[str, Any],
        started: float,
        mode_label: str,
        text_truncated: bool,
        image_count: int,
        request_mode: str,
        extra: Optional[Dict[str, Any]] = None,
        rule_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        reason = rule_reason or aggregation.get("reason")
        if aggregation.get("overall_status") == STATUS_MANUAL_REVIEW:
            status = STATUS_MANUAL_REVIEW
        else:
            status = aggregation.get("overall_status", STATUS_MANUAL_REVIEW)
        payload: Dict[str, Any] = {
            "post_id": post_id,
            "overall_status": status,
            "reason": reason,
            "per_image_results": aggregation.get("per_image_results", []),
            "failed_images": aggregation.get("failed_images", []),
            "rule_intercepted": bool(aggregation.get("rule_intercepted")),
            "current_mode": mode_label,
            "image_count": image_count,
            "request_mode": request_mode,
            "text_truncated": text_truncated,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
            "queue": self.worker.stats(),
        }
        if extra:
            payload.update(extra)
        return payload
