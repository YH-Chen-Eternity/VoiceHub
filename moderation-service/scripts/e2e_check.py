"""本地端到端验收脚本（需要先启动 mock 与审核服务）。

用法：
    python scripts/mock_services.py --aliyun-port 9101 --image-port 9102
    python scripts/e2e_check.py --base-url http://127.0.0.1:8010 \
        --mock-url http://127.0.0.1:9101 --image-base http://127.0.0.1:9102

覆盖的验收点：
1. 全部 low -> PASS
2. 存在 medium -> MANUAL_REVIEW
3. 9 图 + 手机号 -> 前置拦截，0 次 API 调用
4. 9 图 + 可疑配文 -> 9 次图文审核，峰值 QPS <= 10
5. 单图超时 -> MANUAL_REVIEW 且 failed_images 非空
6. 命中“学生欺凌”标签 -> 强制 MANUAL_REVIEW
7. 空图片列表 -> MANUAL_REVIEW，0 次 API 调用
"""

from __future__ import annotations

import argparse
import sys
from typing import Any, Dict, List

import httpx


def _reset_stats(client: httpx.Client, mock_url: str) -> None:
    client.post("%s/stats/reset" % mock_url).raise_for_status()


def _stats(client: httpx.Client, mock_url: str) -> Dict[str, Any]:
    return client.get("%s/stats" % mock_url).raise_for_status().json()


def _audit(client: httpx.Client, base_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    response = client.post("%s/audit" % base_url, json=payload)
    response.raise_for_status()
    return response.json()


def _check(name: str, condition: bool, detail: str = "") -> bool:
    print("%s %s%s" % ("[PASS]" if condition else "[FAIL]", name, " " + detail if detail else ""))
    return condition


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8010")
    parser.add_argument("--mock-url", default="http://127.0.0.1:9101")
    parser.add_argument("--image-base", default="http://127.0.0.1:9102")
    args = parser.parse_args()

    ok = True
    with httpx.Client(timeout=60.0) as client:
        health = client.get("%s/health" % args.base_url).raise_for_status().json()
        ok &= _check(
            "health 可访问且为 NORMAL",
            health.get("mode") == "NORMAL",
            "mode=%s endpoint=%s" % (health.get("mode"), health.get("endpoint")),
        )
        print(
            "  AK=%s SK=%s SDK=%s qps=%s"
            % (
                health.get("ak_ready"),
                health.get("sk_ready"),
                health.get("sdk_available"),
                health.get("success_rate"),
            )
        )

        # 1. low -> PASS
        _reset_stats(client, args.mock_url)
        result = _audit(
            client,
            args.base_url,
            {
                "post_id": "e2e-low",
                "text": "nice song today",
                "image_urls": ["%s/low1.jpg" % args.image_base],
            },
        )
        stats = _stats(client, args.mock_url)
        ok &= _check(
            "低风险图片 -> PASS",
            result["overall_status"] == "PASS" and stats["total_calls"] == 1,
            "status=%s calls=%s" % (result["overall_status"], stats["total_calls"]),
        )

        # 2. medium -> MANUAL_REVIEW
        _reset_stats(client, args.mock_url)
        result = _audit(
            client,
            args.base_url,
            {
                "post_id": "e2e-medium",
                "text": "share this song",
                "image_urls": [
                    "%s/medium1.jpg" % args.image_base,
                    "%s/low2.jpg" % args.image_base,
                ],
            },
        )
        ok &= _check(
            "中风险图片 -> MANUAL_REVIEW",
            result["overall_status"] == "MANUAL_REVIEW",
            "status=%s" % result["overall_status"],
        )

        # 3. 9 图 + 手机号 -> 前置拦截，0 次 API
        _reset_stats(client, args.mock_url)
        result = _audit(
            client,
            args.base_url,
            {
                "post_id": "e2e-phone",
                "text": "联系我 13800138000 一起唱歌",
                "image_urls": [
                    "%s/low%d.jpg" % (args.image_base, index) for index in range(9)
                ],
            },
        )
        stats = _stats(client, args.mock_url)
        ok &= _check(
            "手机号前置拦截 -> MANUAL_REVIEW 且 0 次 API",
            result["overall_status"] == "MANUAL_REVIEW"
            and result["rule_intercepted"]
            and stats["total_calls"] == 0,
            "status=%s calls=%s rule=%s"
            % (result["overall_status"], stats["total_calls"], result.get("reason")),
        )

        # 4. 9 图 + 可疑配文 -> 9 次图文审核，峰值 QPS <= 10
        _reset_stats(client, args.mock_url)
        result = _audit(
            client,
            args.base_url,
            {
                "post_id": "e2e-nine",
                "text": "wechat: abcdefg123 一起玩",
                "image_urls": [
                    "%s/low%d.jpg" % (args.image_base, index) for index in range(9)
                ],
            },
        )
        stats = _stats(client, args.mock_url)
        ok &= _check(
            "九宫格图文审核 -> 9 次调用且峰值 QPS <= 10",
            result["overall_status"] == "PASS"
            and stats["total_calls"] == 9
            and stats["peak_qps_1s"] <= 10
            and result["request_mode"] == "multimodal",
            "status=%s calls=%s peak_qps=%s mode=%s"
            % (
                result["overall_status"],
                stats["total_calls"],
                stats["peak_qps_1s"],
                result["request_mode"],
            ),
        )
        ok &= _check(
            "九宫格结果含 9 条 per_image_results",
            len(result["per_image_results"]) == 9,
            "count=%s" % len(result["per_image_results"]),
        )

        # 5. 单图超时 -> MANUAL_REVIEW + failed_images
        _reset_stats(client, args.mock_url)
        urls = [
            "%s/low%d.jpg" % (args.image_base, index) for index in range(8)
        ] + ["%s/timeout1.jpg" % args.image_base]
        result = _audit(
            client,
            args.base_url,
            {
                "post_id": "e2e-timeout",
                "text": "share this song",
                "image_urls": urls,
            },
        )
        ok &= _check(
            "单图超时 -> MANUAL_REVIEW 且 failed_images 非空",
            result["overall_status"] == "MANUAL_REVIEW"
            and len(result["failed_images"]) >= 1,
            "status=%s failed=%s"
            % (result["overall_status"], len(result["failed_images"])),
        )

        # 6. “学生欺凌”标签 -> 强制人工
        _reset_stats(client, args.mock_url)
        result = _audit(
            client,
            args.base_url,
            {
                "post_id": "e2e-bully",
                "text": "share this song",
                "image_urls": ["%s/bully.jpg" % args.image_base],
            },
        )
        labels: List[str] = []
        for item in result["per_image_results"]:
            labels.extend(item.get("labels") or [])
        ok &= _check(
            "命中“学生欺凌” -> 强制 MANUAL_REVIEW",
            result["overall_status"] == "MANUAL_REVIEW" and "学生欺凌" in labels,
            "status=%s labels=%s" % (result["overall_status"], labels),
        )

        # 7. 空图片列表 -> MANUAL_REVIEW，0 次 API
        _reset_stats(client, args.mock_url)
        result = _audit(
            client,
            args.base_url,
            {"post_id": "e2e-empty", "text": "only text", "image_urls": []},
        )
        stats = _stats(client, args.mock_url)
        ok &= _check(
            "空图片列表 -> MANUAL_REVIEW 且 0 次 API",
            result["overall_status"] == "MANUAL_REVIEW" and stats["total_calls"] == 0,
            "status=%s calls=%s" % (result["overall_status"], stats["total_calls"]),
        )

        health = client.get("%s/health" % args.base_url).raise_for_status().json()
        print(
            "最终 health: mode=%s endpoint=%s queue_depth=%s success_rate=%s"
            % (
                health.get("mode"),
                health.get("endpoint"),
                health.get("queue_depth"),
                health.get("success_rate"),
            )
        )

    print("E2E 结果:", "全部通过" if ok else "存在失败项")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
