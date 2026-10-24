"""本地联调用的阿里云审核智能体 mock。

用法：
    python scripts/mock_services.py --aliyun-port 9101 --image-port 9102

提供的接口：
- POST http://127.0.0.1:9101/   模拟 MultiModalAgent / TextModeration / ImageModeration
- GET  http://127.0.0.1:9101/stats  查看调用次数与 1 秒内峰值 QPS
- GET  http://127.0.0.1:9102/<name>.jpg 模拟图片源站
    - name 含 medium/high/low/none 决定风险等级
    - bully -> medium + “学生欺凌”；abuse -> medium + “恶意丑化”
    - fail -> HTTP 500；timeout -> 延迟 5 秒
    - big -> 声明 21MB；forbidden -> 403

仅用于本地验收，禁止部署到生产。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from collections import deque
from typing import Any, Deque, Dict, Tuple

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

ALIYUN_APP = FastAPI(title="mock-aliyun-green")
IMAGE_APP = FastAPI(title="mock-image-origin")

_call_times: Deque[float] = deque(maxlen=10000)
_total_calls = 0
_standard_calls = 0

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082"
)


def _peak_qps() -> int:
    if not _call_times:
        return 0
    times = sorted(_call_times)
    peak = 0
    left = 0
    for right, stamp in enumerate(times):
        while stamp - times[left] > 1.0:
            left += 1
        peak = max(peak, right - left + 1)
    return peak


def _parse_params(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw = payload.get("ServiceParameters") or payload.get("serviceParameters")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return raw or {}


def _extract_image_url(params: Dict[str, Any]) -> str:
    images = params.get("images") or params.get("imageUrl") or ""
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, dict):
            return str(first.get("imageUrl") or "")
        return str(first)
    if isinstance(images, dict):
        return str(images.get("imageUrl") or "")
    return str(images)


def _risk_from_url(url: str) -> Tuple[str, list]:
    lowered = url.lower()
    if "fail" in lowered:
        return "api_failure", []
    if "bully" in lowered:
        return "medium", ["学生欺凌"]
    if "abuse" in lowered:
        return "medium", ["恶意丑化"]
    if "high" in lowered:
        return "high", ["违规内容"]
    if "medium" in lowered:
        return "medium", ["疑似违规"]
    if "none" in lowered:
        return "none", []
    return "low", []


@ALIYUN_APP.get("/stats")
async def stats() -> Dict[str, Any]:
    return {
        "total_calls": _total_calls,
        "standard_calls": _standard_calls,
        "peak_qps_1s": _peak_qps(),
        "calls_last_10s": sum(
            1 for stamp in _call_times if time.monotonic() - stamp <= 10
        ),
    }


@ALIYUN_APP.post("/stats/reset")
async def reset_stats() -> Dict[str, bool]:
    global _total_calls, _standard_calls
    _call_times.clear()
    _total_calls = 0
    _standard_calls = 0
    return {"ok": True}


@ALIYUN_APP.head("/")
async def head_root() -> Response:
    return Response(status_code=200)


@ALIYUN_APP.post("/")
async def moderate(request: Request):
    global _total_calls, _standard_calls
    _total_calls += 1
    _call_times.append(time.monotonic())
    raw_body = await request.body()
    try:
        with open("mock_requests.log", "a", encoding="utf-8") as fh:
            fh.write(
                "ct=%s action=%s body=%r\n"
                % (
                    request.headers.get("content-type"),
                    request.headers.get("x-acs-action"),
                    raw_body[:500],
                )
            )
    except OSError:
        pass
    try:
        payload = json.loads(raw_body or b"{}")
    except json.JSONDecodeError:
        # 阿里云 Python SDK 使用 application/x-www-form-urlencoded：
        # AppID=...&ServiceParameters=<JSON 字符串>
        from urllib.parse import parse_qs

        try:
            form = parse_qs(raw_body.decode("utf-8"))
        except Exception:  # noqa: BLE001
            form = {}
        payload = {key: values[0] for key, values in form.items()}
    action = (request.headers.get("x-acs-action") or "").lower()
    params = _parse_params(payload)

    # 标准审核兜底
    if action in {"textmoderation", "imagemoderation"}:
        _standard_calls += 1
        value = str(params.get("content") or params.get("imageUrl") or "").lower()
        if "standardbad" in value:
            return {
                "RequestId": "mock-standard-%d" % _total_calls,
                "Code": 200,
                "Msg": "success",
                "Data": {
                    "Result": [
                        {"Label": "spam", "Confidence": 99.0, "Description": "广告"}
                    ]
                },
            }
        return {
            "RequestId": "mock-standard-%d" % _total_calls,
            "Code": 200,
            "Msg": "success",
            "Data": {"Result": [{"Label": "nonLabel", "Confidence": 100.0}]},
        }

    # 多模态审核智能体
    url = _extract_image_url(params)
    if "timeout" in url.lower():
        await asyncio.sleep(5)
    risk, labels = _risk_from_url(url)
    if risk == "api_failure":
        return JSONResponse(
            status_code=500,
            content={"RequestId": "mock-fail", "Code": 500, "Msg": "mock failure"},
        )
    if risk in {"none", "low"}:
        result = [{"Label": "nonLabel", "Description": "未检测出风险"}]
    else:
        result = [
            {"Label": label, "Description": "审核智能体"} for label in labels
        ] or [{"Label": "疑似违规", "Description": "审核智能体"}]
    return {
        "RequestId": "mock-agent-%d" % _total_calls,
        "Code": 200,
        "Msg": "success",
        "Data": {
            "DataId": params.get("dataId") or "mock",
            "TaskId": "TASK-%d" % _total_calls,
            "RiskLevel": risk,
            "Result": result,
        },
    }


@IMAGE_APP.head("/{path:path}")
async def image_head(path: str) -> Response:
    return Response(status_code=200)


@IMAGE_APP.get("/{path:path}")
async def image_get(path: str) -> Response:
    lowered = path.lower()
    if "forbidden" in lowered:
        return Response(status_code=403)
    if "timeout" in lowered:
        await asyncio.sleep(5)
    headers = {}
    if "big" in lowered:
        headers["Content-Length"] = str(21 * 1024 * 1024)
    return Response(
        content=PNG_1PX,
        media_type="image/png",
        headers=headers,
        status_code=206 if "range" in lowered else 200,
    )


async def _serve(port: int, app) -> None:
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--aliyun-port", type=int, default=9101)
    parser.add_argument("--image-port", type=int, default=9102)
    args = parser.parse_args()
    print(
        "mock aliyun: http://127.0.0.1:%d/ , images: http://127.0.0.1:%d/"
        % (args.aliyun_port, args.image_port)
    )
    await asyncio.gather(
        _serve(args.aliyun_port, ALIYUN_APP),
        _serve(args.image_port, IMAGE_APP),
    )


if __name__ == "__main__":
    asyncio.run(main())
