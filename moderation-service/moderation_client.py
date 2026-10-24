"""阿里云内容安全「审核智能体」（MultiModalAgent）客户端。

关键设计（均为业务硬约束）：
1. 分级映射由 config.RISK_MAPPING 统一决定，本模块只返回原始 RiskLevel。
2. 默认仅使用上海 Endpoint；如显式配置多个 Endpoint，按顺序探测并切换；全部失败进入 DEGRADED。
3. DEGRADED 状态下不发起任何外部 API 调用，由上层返回 API_UNAVAILABLE。
4. 所有 API 尝试（含重试、标准审核兜底）统一经过 10 次/秒限流器。
5. 运行时连续 2 次网络超时会触发一次重新探测并临时切换 Endpoint。

日志约束：不输出 AK/SK；图片 URL 一律经 security.redact_url 脱敏。
"""

from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

import httpx

from config import (
    DEGRADED_REASON_ENDPOINTS_DOWN,
    DEGRADED_REASON_NO_CREDENTIALS,
    DEGRADED_REASON_SDK_MISSING,
    MODE_DEGRADED,
    MODE_NORMAL,
    RISK_MAPPING,
    Settings,
    split_endpoint,
)
from security import redact_url

logger = logging.getLogger("moderation.client")

PASS_LABELS = {"nonlabel", "non_label", "pass", "normal"}

# 错误分类
ERR_TIMEOUT = "timeout"
ERR_RATE_LIMITED = "rate_limited"
ERR_INVALID_PARAMETER = "invalid_parameter"
ERR_SERVER = "server_error"
ERR_NETWORK = "network"
ERR_RESPONSE = "response_invalid"
ERR_API_UNAVAILABLE = "api_unavailable"

RETRYABLE_ERRORS = {ERR_TIMEOUT, ERR_RATE_LIMITED, ERR_SERVER, ERR_NETWORK}


def _load_sdk() -> Tuple[Any, Any, Any]:
    """加载阿里云 SDK，并兼容 3.5.1 与 tea-openapi 0.4.6 的模块命名差异。

    3.5.1 的 models/client 仍引用驼峰模块名 websocketUtils(_models)，
    而 tea-openapi 0.4.6 已改为下划线命名。这里做一次运行时别名，
    不修改第三方包内容。
    """
    try:
        import alibabacloud_tea_openapi

        try:
            ws = importlib.import_module("alibabacloud_tea_openapi.websocket_utils")
            wsm = importlib.import_module(
                "alibabacloud_tea_openapi.websocket_utils_models"
            )
            sys.modules.setdefault("alibabacloud_tea_openapi.websocketUtils", ws)
            sys.modules.setdefault(
                "alibabacloud_tea_openapi.websocketUtils_models", wsm
            )
            alibabacloud_tea_openapi.websocketUtils = ws
            alibabacloud_tea_openapi.websocketUtils_models = wsm
        except Exception:  # noqa: BLE001 - 旧版本 SDK 不需要别名
            pass

        from alibabacloud_green20220302 import models
        from alibabacloud_green20220302.client import Client
        from alibabacloud_tea_openapi.models import Config

        return Client, models, Config
    except Exception as exc:  # noqa: BLE001
        logger.error("阿里云内容安全 SDK 加载失败: %s", exc)
        return None, None, None


def sdk_version() -> str:
    try:
        from importlib.metadata import version

        return version("alibabacloud_green20220302")
    except Exception:  # noqa: BLE001
        return "unknown"


class AsyncRateLimiter:
    """固定间隔限流器，保证全局 API 速率不超过 rate_per_second。"""

    def __init__(self, rate_per_second: float) -> None:
        self._interval = 1.0 / max(rate_per_second, 0.001)
        self._next_time = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._next_time - now
            self._next_time = max(now, self._next_time) + self._interval
        if wait > 0:
            await asyncio.sleep(wait)


class CallMetrics:
    """最近 60 秒 API 尝试成功率统计。"""

    def __init__(self, window_seconds: float = 60.0) -> None:
        self._window = window_seconds
        self._records: Deque[Tuple[float, bool]] = deque()

    def record(self, success: bool) -> None:
        now = time.monotonic()
        self._records.append((now, success))
        self._trim(now)

    def _trim(self, now: Optional[float] = None) -> None:
        now = now if now is not None else time.monotonic()
        cutoff = now - self._window
        while self._records and self._records[0][0] < cutoff:
            self._records.popleft()

    def snapshot(self) -> Dict[str, Any]:
        self._trim()
        total = len(self._records)
        if total == 0:
            return {"calls_last_minute": 0, "success_rate": None}
        success = sum(1 for _, ok in self._records if ok)
        return {
            "calls_last_minute": total,
            "success_rate": round(success / total, 4),
        }


@dataclass(frozen=True)
class EndpointCandidate:
    raw: str
    protocol: str
    host: str
    region: str

    @property
    def label(self) -> str:
        return self.host


@dataclass
class ProbeResult:
    endpoint: str
    region: str
    healthy: bool
    latency_ms: Optional[int] = None
    error: Optional[str] = None
    checked_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "endpoint": self.endpoint,
            "region": self.region,
            "healthy": self.healthy,
            "latency_ms": self.latency_ms,
            "error": self.error,
            "checked_at": self.checked_at,
        }


@dataclass
class ApiResult:
    """单张图片的审核结果。"""

    ok: bool
    risk_level: Optional[str] = None
    labels: List[str] = field(default_factory=list)
    descriptions: List[str] = field(default_factory=list)
    request_id: Optional[str] = None
    code: Optional[int] = None
    error_type: Optional[str] = None
    error: Optional[str] = None
    endpoint: Optional[str] = None

    @property
    def decision_source(self) -> str:
        return "api" if self.ok else "api_failed"


def _get(obj: Any, name: str) -> Any:
    """同时兼容 SDK 模型属性与 dict 结构。"""
    if obj is None:
        return None
    if isinstance(obj, dict):
        if name in obj:
            return obj[name]
        snake = name
        camel = name
        if "_" in name:
            parts = name.split("_")
            camel = parts[0] + "".join(p.title() for p in parts[1:])
        return obj.get(camel)
    return getattr(obj, name, None)


def _classify_exception(exc: BaseException) -> str:
    name = type(exc).__name__.lower()
    message = str(exc).lower()
    code = str(getattr(exc, "code", "") or "").lower()
    if (
        isinstance(exc, asyncio.TimeoutError)
        or "timeout" in name
        or "timeout" in message
        or "timed out" in message
        or "readtimeout" in code
    ):
        return ERR_TIMEOUT
    if "throttl" in message or code in {"429", "throttling", "flowcontrol"}:
        return ERR_RATE_LIMITED
    if (
        "invalidparameter" in code
        or "invalid_parameter" in message
        or "parameter" in message
        or "400" in code
    ):
        return ERR_INVALID_PARAMETER
    if "connect" in name or "connection" in message or "network" in message:
        return ERR_NETWORK
    return ERR_NETWORK


def _int_or_none(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


class ModerationClient:
    """审核智能体客户端（单实例，进程内共享）。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._limiter = AsyncRateLimiter(settings.qps_limit)
        self.metrics = CallMetrics()
        self.mode = MODE_DEGRADED
        self.degraded_reason: Optional[str] = None
        self._active: Optional[EndpointCandidate] = None
        self._probes: List[ProbeResult] = []
        self._last_probe_at: Optional[float] = None
        self._probe_lock = asyncio.Lock()
        self._sdk_lock = threading.Lock()
        self._sdk_clients: Dict[str, Any] = {}
        self._consecutive_timeouts = 0
        self._notified_degraded = False
        self._notify_tasks: set = set()

        self._sdk_client_cls, self._models, self._config_cls = _load_sdk()
        self.sdk_available = self._sdk_client_cls is not None
        if not settings.credentials_ready:
            self._set_degraded(DEGRADED_REASON_NO_CREDENTIALS)
        elif not self.sdk_available:
            self._set_degraded(DEGRADED_REASON_SDK_MISSING)
        else:
            # 启动时先假定可用，由 select_endpoint() 决定最终模式。
            self.mode = MODE_NORMAL
            self.degraded_reason = None

    # ------------------------------------------------------------------
    # Endpoint 探测与切换
    # ------------------------------------------------------------------
    def _candidates(self) -> List[EndpointCandidate]:
        result = []
        for endpoint, region in self.settings.endpoints:
            protocol, host = split_endpoint(endpoint)
            result.append(EndpointCandidate(endpoint, protocol, host, region))
        return result

    async def _probe(self, candidate: EndpointCandidate) -> ProbeResult:
        url = "%s://%s/" % (candidate.protocol, candidate.host)
        started = time.monotonic()
        checked_at = datetime.now(timezone.utc).isoformat()
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.settings.probe_timeout_seconds),
                follow_redirects=False,
                headers={"User-Agent": "community-moderation-service/probe"},
            ) as client:
                response = await client.head(url)
            latency = int((time.monotonic() - started) * 1000)
            healthy = response.status_code == 200
            return ProbeResult(
                endpoint=candidate.host,
                region=candidate.region,
                healthy=healthy,
                latency_ms=latency,
                error=None if healthy else "HTTP %d" % response.status_code,
                checked_at=checked_at,
            )
        except Exception as exc:  # noqa: BLE001
            latency = int((time.monotonic() - started) * 1000)
            return ProbeResult(
                endpoint=candidate.host,
                region=candidate.region,
                healthy=False,
                latency_ms=latency,
                error="%s: %s" % (type(exc).__name__, str(exc)[:120]),
                checked_at=checked_at,
            )

    async def select_endpoint(self, force: bool = False) -> Optional[EndpointCandidate]:
        """按配置顺序探测并选择可用 Endpoint（默认只有上海）。

        结果会缓存 probe_cache_seconds；force=True 时忽略缓存。
        所有候选都失败时进入 DEGRADED，返回 None。
        """
        if not self.settings.credentials_ready:
            self._set_degraded(DEGRADED_REASON_NO_CREDENTIALS)
            return None
        if not self.sdk_available:
            self._set_degraded(DEGRADED_REASON_SDK_MISSING)
            return None

        async with self._probe_lock:
            now = time.monotonic()
            if (
                not force
                and self._active is not None
                and self.mode == MODE_NORMAL
                and self._last_probe_at is not None
                and now - self._last_probe_at < self.settings.probe_cache_seconds
            ):
                return self._active

            probes: List[ProbeResult] = []
            chosen: Optional[EndpointCandidate] = None
            for candidate in self._candidates():
                result = await self._probe(candidate)
                probes.append(result)
                if result.healthy and chosen is None:
                    chosen = candidate
                    break  # 首个可用 Endpoint 即停止，避免不必要探测与告警
            self._probes = probes
            self._last_probe_at = now

            if chosen is None:
                self._active = None
                self._set_degraded(DEGRADED_REASON_ENDPOINTS_DOWN)
                return None

            was_degraded = self.mode == MODE_DEGRADED
            self._active = chosen
            self.mode = MODE_NORMAL
            self.degraded_reason = None
            self._consecutive_timeouts = 0
            if was_degraded:
                logger.info(
                    "审核服务恢复 NORMAL，当前 Endpoint=%s（%s）",
                    chosen.host,
                    chosen.region,
                )
                self._notified_degraded = False
            else:
                logger.info(
                    "审核服务使用 Endpoint=%s（%s，探测 %dms）",
                    chosen.host,
                    chosen.region,
                    probes[-1].latency_ms or 0,
                )
            return chosen

    def _set_degraded(self, reason: str) -> None:
        """进入 DEGRADED：立即 error 日志 + 可选 webhook 告警。"""
        should_notify = (not self._notified_degraded) or (
            reason != self.degraded_reason
        )
        self.mode = MODE_DEGRADED
        self.degraded_reason = reason
        self._active = None
        logger.error("审核服务进入 DEGRADED 模式: %s", reason)
        if should_notify and self.settings.webhook_url:
            self._notified_degraded = True
            task = asyncio.create_task(self._notify_webhook(reason))
            self._notify_tasks.add(task)
            task.add_done_callback(self._notify_tasks.discard)

    async def _notify_webhook(self, reason: str) -> None:
        payload = {
            "event": "MODERATION_DEGRADED",
            "reason": reason,
            "endpoints": [c.host for c in self._candidates()],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.settings.webhook_timeout_seconds)
            ) as client:
                await client.post(self.settings.webhook_url, json=payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("DEGRADED webhook 发送失败: %s", type(exc).__name__)

    # ------------------------------------------------------------------
    # SDK 调用
    # ------------------------------------------------------------------
    def _get_sdk_client(self, candidate: EndpointCandidate) -> Any:
        key = "%s://%s" % (candidate.protocol, candidate.host)
        with self._sdk_lock:
            if key not in self._sdk_clients:
                config = self._config_cls(
                    access_key_id=self.settings.access_key_id,
                    access_key_secret=self.settings.access_key_secret,
                    protocol=candidate.protocol,
                    region_id=candidate.region or None,
                    endpoint=candidate.host,
                    connect_timeout=self.settings.api_connect_timeout_ms,
                    read_timeout=self.settings.api_read_timeout_ms,
                )
                self._sdk_clients[key] = self._sdk_client_cls(config)
            return self._sdk_clients[key]

    def _invoke_multimodal_sync(
        self, candidate: EndpointCandidate, app_id: str, params: Dict[str, Any]
    ) -> Any:
        client = self._get_sdk_client(candidate)
        request = self._models.MultiModalAgentRequest(
            app_id=app_id,
            service_parameters=json.dumps(params, ensure_ascii=False),
        )
        return client.multi_modal_agent(request)

    def _invoke_standard_sync(
        self, candidate: EndpointCandidate, kind: str, value: str
    ) -> Any:
        client = self._get_sdk_client(candidate)
        if kind == "text":
            params = {"content": value[:10000]}
            request = self._models.TextModerationRequest(
                service=self.settings.standard_text_service,
                service_parameters=json.dumps(params, ensure_ascii=False),
            )
            return client.text_moderation(request)
        params = {"imageUrl": value}
        request = self._models.ImageModerationRequest(
            service=self.settings.standard_image_service,
            service_parameters=json.dumps(params, ensure_ascii=False),
        )
        return client.image_moderation(request)

    def _remaining(self, deadline: Optional[float]) -> Optional[float]:
        if deadline is None:
            return None
        return deadline - time.monotonic()

    def _attempt_timeout(self, deadline: Optional[float]) -> float:
        configured = (
            self.settings.api_connect_timeout_ms + self.settings.api_read_timeout_ms
        ) / 1000.0
        configured = max(configured, 1.0)
        remaining = self._remaining(deadline)
        if remaining is None:
            return configured
        return max(0.1, min(configured, remaining))

    def _parse_agent_response(self, response: Any, candidate: EndpointCandidate) -> ApiResult:
        status = _get(response, "status_code")
        body = _get(response, "body")
        code = _int_or_none(_get(body, "code"))
        request_id = _get(body, "request_id") or _get(body, "requestId")

        if status is not None and int(status) != 200:
            error_type = ERR_RATE_LIMITED if int(status) == 429 else ERR_SERVER
            return ApiResult(
                ok=False,
                code=code,
                request_id=request_id,
                error_type=error_type,
                error="HTTP %s" % status,
                endpoint=candidate.host,
            )
        if code != 200:
            error_type = (
                ERR_RATE_LIMITED
                if code == 429
                else ERR_INVALID_PARAMETER
                if code is not None and 400 <= code < 500
                else ERR_SERVER
            )
            message = _get(body, "message") or _get(body, "msg") or "Code=%s" % code
            return ApiResult(
                ok=False,
                code=code,
                request_id=request_id,
                error_type=error_type,
                error=str(message)[:200],
                endpoint=candidate.host,
            )

        data = _get(body, "data")
        if data is None:
            return ApiResult(
                ok=False,
                code=code,
                request_id=request_id,
                error_type=ERR_RESPONSE,
                error="响应缺少 Data",
                endpoint=candidate.host,
            )

        risk_level = str(_get(data, "risk_level") or _get(data, "riskLevel") or "").lower()
        if not risk_level:
            risk_level = "unknown"

        labels: List[str] = []
        descriptions: List[str] = []
        result_items = _get(data, "result") or []
        if isinstance(result_items, dict):
            result_items = [result_items]
        for item in result_items:
            label = str(_get(item, "label") or "").strip()
            if label and label.lower() not in PASS_LABELS and label not in labels:
                labels.append(label)
            description = str(_get(item, "description") or "").strip()
            if description and description not in descriptions:
                descriptions.append(description)

        return ApiResult(
            ok=True,
            risk_level=risk_level,
            labels=labels,
            descriptions=descriptions,
            request_id=str(request_id) if request_id else None,
            code=code,
            endpoint=candidate.host,
        )

    def _parse_standard_response(self, response: Any) -> Tuple[bool, List[str]]:
        status = _get(response, "status_code")
        body = _get(response, "body")
        code = _int_or_none(_get(body, "code"))
        if status is not None and int(status) != 200:
            raise RuntimeError("标准审核 HTTP %s" % status)
        if code != 200:
            message = _get(body, "message") or _get(body, "msg") or "Code=%s" % code
            raise RuntimeError(str(message))
        data = _get(body, "data")
        items = _get(data, "result") or []
        if isinstance(items, dict):
            items = [items]
        labels = []
        for item in items:
            label = str(_get(item, "label") or "").strip()
            if label and label.lower() not in PASS_LABELS and label not in labels:
                labels.append(label)
        return bool(labels), labels

    async def call_multimodal(
        self,
        *,
        task_id: str,
        image_url: str,
        text: Optional[str] = None,
        app_id: Optional[str] = None,
        deadline: Optional[float] = None,
    ) -> ApiResult:
        """调用 MultiModalAgent 审核单张图片（可附带配文）。

        失败会按错误类型重试（指数退避，最多 api_max_retries 次重试）；
        连续 2 次网络超时触发一次 Endpoint 重新探测。
        任何失败均返回 ok=False，由聚合器将整组转人工。
        """
        if self.mode != MODE_NORMAL or self._active is None:
            return ApiResult(
                ok=False,
                error_type=ERR_API_UNAVAILABLE,
                error=self.degraded_reason or "服务未就绪",
            )
        if not self.sdk_available or self._models is None:
            return ApiResult(
                ok=False, error_type=ERR_API_UNAVAILABLE, error=DEGRADED_REASON_SDK_MISSING
            )

        chosen_app_id = app_id or (
            self.settings.multimodal_app_id
            if text
            else self.settings.image_app_id
        )
        safe_text = (text or "")[: self.settings.max_text_chars]
        params: Dict[str, Any] = {
            "dataId": task_id,
            "images": [{"imageUrl": image_url}],
        }
        if safe_text:
            params["content"] = safe_text

        reprobed = False
        last_error: Optional[ApiResult] = None
        attempts = self.settings.api_max_retries + 1

        for attempt in range(attempts):
            candidate = self._active
            if candidate is None or self.mode != MODE_NORMAL:
                return ApiResult(
                    ok=False,
                    error_type=ERR_API_UNAVAILABLE,
                    error=self.degraded_reason or "服务未就绪",
                )
            remaining = self._remaining(deadline)
            if remaining is not None and remaining <= 0.05:
                return ApiResult(
                    ok=False,
                    error_type=ERR_TIMEOUT,
                    error="任务总超时，未完成 API 调用",
                    endpoint=candidate.host,
                )

            # 【业务硬约束 · QPS 整形】所有尝试（含重试）共享 10 次/秒限流器
            await self._limiter.acquire()
            timeout = self._attempt_timeout(deadline)
            started = time.monotonic()
            try:
                response = await asyncio.wait_for(
                    asyncio.to_thread(
                        self._invoke_multimodal_sync, candidate, chosen_app_id, params
                    ),
                    timeout=timeout,
                )
                result = self._parse_agent_response(response, candidate)
            except asyncio.TimeoutError:
                self.metrics.record(False)
                result = ApiResult(
                    ok=False,
                    error_type=ERR_TIMEOUT,
                    error="API 调用超时",
                    endpoint=candidate.host,
                )
            except Exception as exc:  # noqa: BLE001
                self.metrics.record(False)
                result = ApiResult(
                    ok=False,
                    error_type=_classify_exception(exc),
                    error=("%s: %s" % (type(exc).__name__, str(exc)))[:200],
                    endpoint=candidate.host,
                )
            else:
                self.metrics.record(result.ok)
                logger.debug(
                    "审核调用 task=%s endpoint=%s elapsed=%dms risk=%s",
                    task_id,
                    candidate.host,
                    int((time.monotonic() - started) * 1000),
                    result.risk_level,
                )

            if result.ok:
                self._consecutive_timeouts = 0
                return result

            last_error = result
            if result.error_type == ERR_TIMEOUT:
                self._consecutive_timeouts += 1
            else:
                self._consecutive_timeouts = 0

            # 连续 2 次网络超时：强制重新探测，必要时切换 Endpoint（只触发一次）
            if (
                self._consecutive_timeouts >= 2
                and not reprobed
                and result.error_type == ERR_TIMEOUT
            ):
                reprobed = True
                previous = candidate.host
                logger.warning(
                    "连续 2 次网络超时，触发 Endpoint 重新探测（原 %s）", previous
                )
                switched = await self.select_endpoint(force=True)
                if switched is None:
                    return ApiResult(
                        ok=False,
                        error_type=ERR_API_UNAVAILABLE,
                        error=self.degraded_reason or DEGRADED_REASON_ENDPOINTS_DOWN,
                    )
                if switched.host != previous:
                    logger.warning(
                        "Endpoint 已临时切换: %s -> %s", previous, switched.host
                    )

            if result.error_type not in RETRYABLE_ERRORS:
                break
            if attempt < attempts - 1:
                delay = self.settings.retry_base_delay_seconds * (2 ** attempt)
                await asyncio.sleep(delay)

        logger.warning(
            "审核调用失败 task=%s endpoint=%s type=%s error=%s",
            task_id,
            (last_error.endpoint if last_error else "-"),
            (last_error.error_type if last_error else "-"),
            (last_error.error if last_error else "-"),
        )
        return last_error or ApiResult(
            ok=False, error_type=ERR_NETWORK, error="未知错误"
        )

    async def standard_text_check(self, text: str) -> Tuple[bool, List[str]]:
        return await self._standard_check("text", text)

    async def standard_image_check(self, url: str) -> Tuple[bool, List[str]]:
        return await self._standard_check("image", url)

    async def _standard_check(self, kind: str, value: str) -> Tuple[bool, List[str]]:
        """可选的标准审核兜底；失败只记录，不误判为命中。"""
        if self.mode != MODE_NORMAL or self._active is None or self._models is None:
            return False, []
        candidate = self._active
        await self._limiter.acquire()
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(self._invoke_standard_sync, candidate, kind, value),
                timeout=self._attempt_timeout(None),
            )
            hit, labels = self._parse_standard_response(response)
            self.metrics.record(True)
            if hit:
                logger.warning(
                    "标准审核命中 kind=%s labels=%s", kind, ",".join(labels)
                )
            return hit, labels
        except Exception as exc:  # noqa: BLE001
            self.metrics.record(False)
            logger.warning(
                "标准审核调用失败 kind=%s value=%s error=%s",
                kind,
                redact_url(value) if kind == "image" else "<text>",
                type(exc).__name__,
            )
            return False, []

    # ------------------------------------------------------------------
    # 状态快照
    # ------------------------------------------------------------------
    def health_snapshot(self) -> Dict[str, Any]:
        metrics = self.metrics.snapshot()
        return {
            "mode": self.mode,
            "endpoint": self._active.host if self._active else None,
            "endpoint_region": self._active.region if self._active else None,
            "probe_results": [probe.to_dict() for probe in self._probes],
            "ak_ready": self.settings.ak_ready,
            "sk_ready": self.settings.sk_ready,
            "sdk_available": self.sdk_available,
            "sdk_version": sdk_version(),
            "degraded_reason": self.degraded_reason,
            "calls_last_minute": metrics["calls_last_minute"],
            "success_rate": metrics["success_rate"],
        }

    def is_ready(self) -> bool:
        return self.mode == MODE_NORMAL and self._active is not None

    def active_endpoint_label(self) -> Optional[str]:
        return self._active.host if self._active else None
