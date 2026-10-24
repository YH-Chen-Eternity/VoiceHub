"""流水线/队列行为测试（不访问真实阿里云）。"""

from __future__ import annotations

import pytest

from config import (
    MODE_DEGRADED,
    STATUS_API_UNAVAILABLE,
    STATUS_MANUAL_REVIEW,
    STATUS_PASS,
    Settings,
)
from moderation_client import ApiResult
from pipeline import AuditPipeline, AuditRequestError
from queue_worker import QueueWorker

IMG = "http://127.0.0.1:9102/%s.jpg"


def make_settings(**overrides) -> Settings:
    params = dict(
        access_key_id="test-ak",
        access_key_secret="test-sk",
        endpoints=(("http://127.0.0.1:9", "test"),),
        image_preflight_enabled=False,
        app_env="test",
        test_allow_private_image_urls=True,
        audit_timeout_seconds=5.0,
    )
    params.update(overrides)
    return Settings(**params)


class FakeClient:
    def __init__(self, settings: Settings, resolver=None):
        self.settings = settings
        self.mode = "NORMAL"
        self.calls = []
        self.resolver = resolver or (
            lambda url: ApiResult(ok=True, risk_level="low", labels=[])
        )

    async def standard_text_check(self, text):
        return False, []

    async def standard_image_check(self, url):
        return False, []

    async def call_multimodal(self, **kwargs):
        self.calls.append(kwargs)
        return self.resolver(kwargs["image_url"])


async def run_audit(settings, client, post_id="post", text="", urls=None):
    worker = QueueWorker(client, settings)
    pipeline = AuditPipeline(client, worker, settings)
    await worker.start()
    try:
        return await pipeline.audit(post_id, text, urls or [])
    finally:
        await worker.stop()


async def test_nine_low_images_pass():
    settings = make_settings()
    client = FakeClient(settings)
    result = await run_audit(
        settings,
        client,
        text="今天分享一首歌",
        urls=[IMG % ("low%d" % i) for i in range(9)],
    )
    assert result["overall_status"] == STATUS_PASS
    assert len(result["per_image_results"]) == 9
    assert result["failed_images"] == []
    assert len(client.calls) == 9
    assert result["request_mode"] == "image_only"
    assert result["per_image_results"][0]["task_id"] == "post_0"
    assert all(call["text"] is None for call in client.calls)


async def test_any_medium_makes_group_manual():
    settings = make_settings()

    def resolver(url):
        if "medium" in url:
            return ApiResult(ok=True, risk_level="medium", labels=["疑似违规"])
        return ApiResult(ok=True, risk_level="low", labels=[])

    client = FakeClient(settings, resolver)
    result = await run_audit(
        settings, client, urls=[IMG % "low", IMG % "medium", IMG % "none"]
    )
    assert result["overall_status"] == STATUS_MANUAL_REVIEW


async def test_single_failure_makes_group_manual_and_lists_failed():
    settings = make_settings()

    def resolver(url):
        if "fail" in url:
            return ApiResult(ok=False, error="mock failure", error_type="server_error")
        return ApiResult(ok=True, risk_level="low", labels=[])

    client = FakeClient(settings, resolver)
    result = await run_audit(
        settings,
        client,
        urls=[IMG % "low", IMG % "fail", IMG % "low"],
    )
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
    assert len(result["failed_images"]) == 1
    assert result["failed_images"][0]["task_id"] == "post_1"


async def test_phone_text_intercepted_without_api_call():
    settings = make_settings()
    client = FakeClient(settings)
    result = await run_audit(
        settings,
        client,
        text="加我 13800138000",
        urls=[IMG % "low"],
    )
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
    assert result["rule_intercepted"] is True
    assert client.calls == []


async def test_risky_text_uses_multimodal():
    settings = make_settings()
    client = FakeClient(settings)
    result = await run_audit(
        settings,
        client,
        text="代购加微信 abcdef12",
        urls=[IMG % "low"],
    )
    assert result["request_mode"] == "multimodal"
    assert len(client.calls) == 1
    assert client.calls[0]["text"] == "代购加微信 abcdef12"
    assert client.calls[0]["app_id"] == settings.multimodal_app_id


async def test_empty_images_manual():
    settings = make_settings()
    client = FakeClient(settings)
    result = await run_audit(settings, client, text="hello", urls=[])
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
    assert client.calls == []


async def test_all_invalid_urls_manual_without_api_call():
    settings = make_settings()
    client = FakeClient(settings)
    result = await run_audit(
        settings,
        client,
        urls=["ftp://example.com/a.jpg", "javascript:alert(1)"],
    )
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
    assert len(result["failed_images"]) == 2
    assert client.calls == []


async def test_degraded_returns_api_unavailable():
    settings = make_settings()
    client = FakeClient(settings)
    client.mode = MODE_DEGRADED
    result = await run_audit(settings, client, urls=[IMG % "low"])
    assert result["overall_status"] == STATUS_API_UNAVAILABLE
    assert client.calls == []


async def test_more_than_nine_images_rejected():
    settings = make_settings()
    client = FakeClient(settings)
    with pytest.raises(AuditRequestError):
        await run_audit(settings, client, urls=[IMG % "low"] * 10)


async def test_forced_label_overrides_medium():
    settings = make_settings()

    def resolver(url):
        return ApiResult(ok=True, risk_level="medium", labels=["学生欺凌"])

    client = FakeClient(settings, resolver)
    result = await run_audit(settings, client, urls=[IMG % "bully"])
    assert result["overall_status"] == STATUS_MANUAL_REVIEW
    assert result["per_image_results"][0]["labels"] == ["学生欺凌"]
