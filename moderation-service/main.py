"""FastAPI 入口。

接口：
- POST /audit  : 提交帖子图文审核（1~9 张图片），内部排队并等待聚合结果。
- GET  /health : 当前模式、Endpoint、队列积压、近 1 分钟 API 成功率。

启动时仅打印环境是否就绪与 SDK 版本，绝不打印 AK/SK。
"""

from __future__ import annotations

import asyncio
import logging
import platform
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from config import (
    MODE_DEGRADED,
    MODE_NORMAL,
    STATUS_API_UNAVAILABLE,
    STATUS_MANUAL_REVIEW,
    Settings,
)
from moderation_client import ModerationClient, sdk_version
from pipeline import AuditPipeline, AuditRequestError
from queue_worker import QueueWorker

try:  # 本地开发可用 .env；生产建议直接注入环境变量
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # noqa: BLE001
    pass

logger = logging.getLogger("moderation.main")

APP_VERSION = "1.0.0"


class AuditRequest(BaseModel):
    """审核请求。单次最多 9 张图片，配文最多 2000 字符。"""

    post_id: Union[str, int] = Field(..., description="帖子 ID，字符串或整数")
    text: str = Field("", max_length=2000)
    image_urls: List[str] = Field(default_factory=list, max_length=9)

    @field_validator("post_id")
    @classmethod
    def _normalize_post_id(cls, value: Union[str, int]) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("post_id 不能为空")
        if len(normalized) > 128:
            raise ValueError("post_id 长度不能超过 128")
        return normalized


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


async def _recovery_loop(client: ModerationClient, settings: Settings) -> None:
    """DEGRADED 后台恢复探测；请求路径上绝不反复探测。"""
    while True:
        try:
            await asyncio.sleep(settings.degraded_recovery_seconds)
            if client.mode == MODE_DEGRADED and settings.credentials_ready:
                logger.info("DEGRADED 恢复探测开始")
                await client.select_endpoint(force=True)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("DEGRADED 恢复探测异常")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    _configure_logging(settings.log_level)

    client = ModerationClient(settings)
    worker = QueueWorker(client, settings)
    pipeline = AuditPipeline(client, worker, settings)

    logger.info(
        "================================================================"
    )
    logger.info("校园音乐社区内容审核服务启动 v%s", APP_VERSION)
    logger.info(
        "Python=%s SDK=%s FastAPI=%s",
        platform.python_version(),
        sdk_version(),
        _fastapi_version(),
    )
    logger.info(
        "凭证就绪: AK=%s SK=%s（值不输出）",
        settings.ak_ready,
        settings.sk_ready,
    )
    logger.info(
        "Endpoint 候选: %s",
        " / ".join("%s(%s)" % item for item in settings.endpoints),
    )
    logger.info(
        "审核智能体 AppID: multimodal=%s image=%s",
        settings.multimodal_app_id,
        settings.image_app_id,
    )
    logger.info(
        "QPS上限=%d 队列容量=%d 单任务超时=%.0fs 队列等待上限=%.0fs 标准审核=%s",
        settings.qps_limit,
        settings.queue_capacity,
        settings.task_timeout_seconds,
        settings.queue_max_wait_seconds,
        settings.standard_check_enabled,
    )

    if settings.credentials_ready and client.sdk_available:
        chosen = await client.select_endpoint(force=True)
        if chosen is not None:
            logger.info(
                "启动探测成功，当前 Endpoint=%s（%s）",
                chosen.host,
                chosen.region,
            )
    else:
        logger.error("启动即降级: %s", client.degraded_reason)

    await worker.start()
    recovery = asyncio.create_task(
        _recovery_loop(client, settings), name="degraded-recovery"
    )

    app.state.settings = settings
    app.state.client = client
    app.state.worker = worker
    app.state.pipeline = pipeline
    app.state.started_at = time.monotonic()
    app.state.recovery_task = recovery

    try:
        yield
    finally:
        recovery.cancel()
        try:
            await recovery
        except asyncio.CancelledError:
            pass
        await worker.stop()
        logger.info("审核服务已停止")


def _fastapi_version() -> str:
    try:
        from importlib.metadata import version

        return version("fastapi")
    except Exception:  # noqa: BLE001
        return "unknown"


app = FastAPI(
    title="校园音乐社区内容审核服务",
    version=APP_VERSION,
    description="阿里云内容安全 MultiModalAgent 审核智能体 · 九宫格图文审核",
    lifespan=lifespan,
)


def _get_state() -> Any:
    state = getattr(app, "state", None)
    if state is None or not hasattr(state, "client"):
        return None
    return state


@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "service": "community-moderation-service",
        "version": APP_VERSION,
        "docs": "/docs",
        "health": "/health",
        "audit": "/audit",
    }


@app.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查：模式、Endpoint、队列积压、近 1 分钟成功率、凭证是否就绪。"""
    state = _get_state()
    if state is None:
        return {
            "status": "starting",
            "mode": MODE_DEGRADED,
            "endpoint": None,
            "queue_depth": 0,
            "success_rate": None,
            "ak_ready": False,
            "sk_ready": False,
        }
    client: ModerationClient = state.client
    worker: QueueWorker = state.worker
    snapshot = client.health_snapshot()
    snapshot.update(
        {
            "status": "ok" if client.mode == MODE_NORMAL else "degraded",
            "queue_depth": worker.queue_depth(),
            "in_flight": worker.in_flight(),
            "queue": worker.stats(),
            "uptime_seconds": int(time.monotonic() - state.started_at),
            "version": APP_VERSION,
        }
    )
    return snapshot


@app.post("/audit")
async def audit(request: AuditRequest) -> Dict[str, Any]:
    """提交一次图文审核并等待聚合结果。

    处置结果：
    - PASS: 直接放行
    - MANUAL_REVIEW: 转人工
    - API_UNAVAILABLE: 审核 API 不可用，转人工
    """
    state = _get_state()
    if state is None:
        return _fallback_unavailable(request, "服务正在启动")

    pipeline: AuditPipeline = state.pipeline
    client: ModerationClient = state.client
    try:
        return await pipeline.audit(
            post_id=request.post_id,
            text=request.text,
            image_urls=request.image_urls,
        )
    except AuditRequestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:  # noqa: BLE001
        # 审核链路异常时绝不自动放行，统一转人工。
        logger.exception("审核请求处理异常 post_id=%s", request.post_id)
        return {
            "post_id": request.post_id,
            "overall_status": STATUS_MANUAL_REVIEW,
            "reason": "审核服务内部错误，转人工",
            "per_image_results": [],
            "failed_images": [],
            "rule_intercepted": False,
            "current_mode": client.mode,
            "image_count": len(request.image_urls),
            "request_mode": "unknown",
            "text_truncated": False,
            "elapsed_ms": 0,
            "queue": state.worker.stats(),
        }


def _fallback_unavailable(request: AuditRequest, reason: str) -> Dict[str, Any]:
    return {
        "post_id": request.post_id,
        "overall_status": STATUS_API_UNAVAILABLE,
        "reason": reason,
        "per_image_results": [],
        "failed_images": [],
        "rule_intercepted": False,
        "current_mode": MODE_DEGRADED,
        "image_count": len(request.image_urls),
        "request_mode": "none",
        "text_truncated": False,
        "elapsed_ms": 0,
        "queue": {},
    }


if __name__ == "__main__":
    import os

    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        workers=1,  # 进程内队列 + 全局限流，必须单 worker
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )
