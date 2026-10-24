"""审核任务队列与消费者。

设计要点（业务硬约束）：
- 使用进程内 asyncio.Queue 整形；单 worker 进程，避免多进程绕过 QPS 限制。
- 真正的 10 次/秒限流在 ModerationClient 内统一执行（含重试）。
- 队列最大等待 120 秒；单任务总超时 15 秒（图片预检 + API 调用）。
- 优雅关闭：停止接收新任务，等待在途任务，未完成任务标记 failed 转人工。
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set

from config import Settings
from moderation_client import ApiResult, ModerationClient
from security import preflight_image

logger = logging.getLogger("moderation.queue")


@dataclass
class AuditTask:
    """一条单图审核任务。"""

    task_id: str
    post_id: str
    image_url: str
    text: Optional[str]
    app_id: str
    enqueued_at: float = field(default_factory=time.monotonic)
    deadline: float = 0.0
    future: Optional[asyncio.Future] = None


@dataclass
class TaskOutcome:
    """消费者返回给流水线的结果。"""

    task_id: str
    ok: bool
    result: Optional[ApiResult] = None
    error: Optional[str] = None
    error_type: Optional[str] = None


class QueueWorker:
    """固定容量队列 + 并发消费者。"""

    def __init__(self, client: ModerationClient, settings: Settings) -> None:
        self.client = client
        self.settings = settings
        self.queue: asyncio.Queue = asyncio.Queue(
            maxsize=settings.queue_capacity
        )
        self._consumer: Optional[asyncio.Task] = None
        self._semaphore = asyncio.Semaphore(settings.worker_concurrency)
        self._inflight: Set[asyncio.Task] = set()
        self._stopping = False
        self._last_backlog_warning = 0.0
        self.processed = 0
        self.failed = 0

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------
    async def start(self) -> None:
        if self._consumer is not None:
            return
        self._stopping = False
        self._consumer = asyncio.create_task(self._consume(), name="audit-queue")
        logger.info(
            "审核队列已启动 capacity=%d workers=%d",
            self.settings.queue_capacity,
            self.settings.worker_concurrency,
        )

    async def stop(self) -> None:
        """优雅关闭：停止消费，尽量等待在途任务，其余标记失败。"""
        self._stopping = True
        if self._consumer is not None:
            self._consumer.cancel()
            try:
                await self._consumer
            except asyncio.CancelledError:
                pass
            self._consumer = None

        if self._inflight:
            logger.info("等待 %d 个在途审核任务结束", len(self._inflight))
            done, pending = await asyncio.wait(self._inflight, timeout=5.0)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)

        # 未开始的任务直接失败，交由上游转人工。
        while not self.queue.empty():
            try:
                task: AuditTask = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            self._fail_task(task, "服务关闭，任务未执行", "shutdown")
            self.queue.task_done()
        logger.info("审核队列已停止")

    # ------------------------------------------------------------------
    # 提交与消费
    # ------------------------------------------------------------------
    def queue_depth(self) -> int:
        return self.queue.qsize()

    def in_flight(self) -> int:
        return len(self._inflight)

    def submit(self, task: AuditTask) -> bool:
        """非阻塞提交；队列满返回 False，由调用方标记 failed。"""
        if self._stopping:
            return False
        try:
            self.queue.put_nowait(task)
            depth = self.queue.qsize()
            if depth >= self.settings.queue_warn_depth:
                now = time.monotonic()
                if now - self._last_backlog_warning > 10:
                    self._last_backlog_warning = now
                    logger.warning(
                        "审核队列积压 depth=%d（阈值 %d）",
                        depth,
                        self.settings.queue_warn_depth,
                    )
            return True
        except asyncio.QueueFull:
            logger.error(
                "审核队列已满，拒绝任务 task=%s capacity=%d",
                task.task_id,
                self.settings.queue_capacity,
            )
            return False

    async def _consume(self) -> None:
        while True:
            task: AuditTask = await self.queue.get()
            try:
                if task.future is not None and task.future.done():
                    # 上游已超时/取消，跳过以避免无意义计费。
                    continue
                waited = time.monotonic() - task.enqueued_at
                if waited > self.settings.queue_max_wait_seconds:
                    self._fail_task(
                        task,
                        "队列等待超过 %.0f 秒"
                        % self.settings.queue_max_wait_seconds,
                        "queue_timeout",
                    )
                    continue
                runner = asyncio.create_task(self._run_task(task))
                self._inflight.add(runner)
                runner.add_done_callback(self._inflight.discard)
            finally:
                self.queue.task_done()

    async def _run_task(self, task: AuditTask) -> None:
        async with self._semaphore:
            if task.future is not None and task.future.done():
                return
            # 单任务 15 秒预算从真正开始处理时计算；队列等待时间单独受 120 秒上限约束。
            task.deadline = time.monotonic() + self.settings.task_timeout_seconds
            remaining = self.settings.task_timeout_seconds
            try:
                outcome = await asyncio.wait_for(
                    self._process(task), timeout=remaining
                )
            except asyncio.TimeoutError:
                self._fail_task(
                    task,
                    "单任务处理超时（%.0f 秒）" % self.settings.task_timeout_seconds,
                    "task_timeout",
                )
                return
            except asyncio.CancelledError:
                self._fail_task(task, "任务被取消", "cancelled")
                raise
            except Exception as exc:  # noqa: BLE001
                logger.exception("审核任务异常 task=%s", task.task_id)
                self._fail_task(task, "审核任务异常：%s" % type(exc).__name__, "internal")
                return

            self.processed += 1
            if outcome.ok:
                if task.future is not None and not task.future.done():
                    task.future.set_result(outcome)
            else:
                self.failed += 1
                self._fail_task(
                    task, outcome.error or "审核失败", outcome.error_type or "failed"
                )

    async def _process(self, task: AuditTask) -> TaskOutcome:
        # 1) 图片预检（下载 3 秒超时 / 20MB 上限）
        if self.settings.image_preflight_enabled:
            ok, reason = await preflight_image(
                task.image_url,
                timeout_seconds=self.settings.image_fetch_timeout_seconds,
                max_bytes=self.settings.max_image_bytes,
                allow_private=self.settings.allow_private_image_urls,
            )
            if not ok:
                return TaskOutcome(
                    task_id=task.task_id,
                    ok=False,
                    error=reason,
                    error_type="image_failed",
                )

        # 2) 审核智能体（带 deadline，避免超出单任务预算）
        result = await self.client.call_multimodal(
            task_id=task.task_id,
            image_url=task.image_url,
            text=task.text,
            app_id=task.app_id,
            deadline=task.deadline,
        )
        if not result.ok:
            return TaskOutcome(
                task_id=task.task_id,
                ok=False,
                result=result,
                error=result.error or "API 调用失败",
                error_type=result.error_type or "api_failed",
            )
        return TaskOutcome(task_id=task.task_id, ok=True, result=result)

    # ------------------------------------------------------------------
    # 结果回填
    # ------------------------------------------------------------------
    def _fail_task(self, task: AuditTask, reason: str, error_type: str) -> None:
        if task.future is not None and not task.future.done():
            task.future.set_result(
                TaskOutcome(
                    task_id=task.task_id,
                    ok=False,
                    error=reason,
                    error_type=error_type,
                )
            )

    def stats(self) -> Dict[str, Any]:
        return {
            "queue_depth": self.queue.qsize(),
            "queue_capacity": self.settings.queue_capacity,
            "in_flight": len(self._inflight),
            "processed": self.processed,
            "failed": self.failed,
        }
