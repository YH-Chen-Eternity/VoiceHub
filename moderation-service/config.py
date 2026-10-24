"""服务配置。

所有敏感配置（AccessKey）只从环境变量读取，绝不写入代码、镜像或日志。
其余参数提供安全的默认值，可通过环境变量覆盖。

【业务硬约束】RISK_MAPPING 与 DEGRADED 相关常量属于审核策略的一部分，
调整前必须走变更评审，不得在业务代码中另行改写风险等级判断。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional, Tuple

# ============================================================================
# 【业务硬约束 · 不可随意修改】分级处置映射
# none / low        -> PASS（直接放行）
# medium / high     -> MANUAL_REVIEW（转人工）
# 未知风险等级同样按 MANUAL_REVIEW 处理，宁可多审不可漏审。
# ============================================================================
RISK_MAPPING = {
    "none": "PASS",
    "low": "PASS",
    "medium": "MANUAL_REVIEW",
    "high": "MANUAL_REVIEW",
}

# 这些标签即使风险等级为 medium/low，也必须强制人工复核。
FORCE_MANUAL_REVIEW_LABELS = ("恶意丑化", "学生欺凌")

STATUS_PASS = "PASS"
STATUS_MANUAL_REVIEW = "MANUAL_REVIEW"
STATUS_API_UNAVAILABLE = "API_UNAVAILABLE"

MODE_NORMAL = "NORMAL"
MODE_DEGRADED = "DEGRADED"

# ============================================================================
# 【业务硬约束 · API 不可用降级】
# 1. AK/SK 任一缺失 -> 启动即 DEGRADED，/audit 不发起任何外部 API 调用。
# 2. 所有已配置 Endpoint 探测均失败 -> DEGRADED。
# 3. 降级期间所有请求返回 API_UNAVAILABLE，直接进入人工队列。
# 恢复只能由后台周期探测完成，不允许请求路径上反复探测。
# ============================================================================
DEGRADED_REASON_NO_CREDENTIALS = "未配置 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET"
DEGRADED_REASON_SDK_MISSING = "阿里云内容安全 SDK 未安装或加载失败"
DEGRADED_REASON_ENDPOINTS_DOWN = "已配置的阿里云内容安全 Endpoint 均探测失败"

# 默认仅使用国内上海节点，避免跨境调用成本。
# 如需容灾，可通过 MODERATION_ENDPOINTS 显式追加新加坡等其他节点。
DEFAULT_ENDPOINTS: Tuple[Tuple[str, str], ...] = (
    ("green-cip.cn-shanghai.aliyuncs.com", "cn-shanghai"),
)

DEFAULT_MULTIMODAL_APP_ID = "img_txt_check_agent_01"
DEFAULT_IMAGE_APP_ID = "img_check_agent_01"
DEFAULT_TEXT_APP_ID = "txt_check_agent_01"


def _env_str(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(str(raw).strip())
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _parse_endpoints(raw: str) -> Tuple[Tuple[str, str], ...]:
    """解析 MODERATION_ENDPOINTS。

    格式：``host[:region],host[:region]``，也允许测试时使用 ``http://127.0.0.1:9101=test``。
    未配置时返回仅上海节点的默认候选；如需容灾可显式追加其他节点。
    Endpoint 属于受信任配置，不接受用户输入。
    """
    if not raw:
        return DEFAULT_ENDPOINTS
    result = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if "=" in item:
            endpoint, region = item.rsplit("=", 1)
        else:
            endpoint, region = item, ""
        endpoint = endpoint.strip().rstrip("/")
        if not endpoint:
            continue
        result.append((endpoint, region.strip()))
    return tuple(result) if result else DEFAULT_ENDPOINTS


def split_endpoint(endpoint: str) -> Tuple[str, str]:
    """把候选 Endpoint 拆成 (protocol, host)。

    默认 https；仅当显式配置 ``http://`` 前缀时使用 http（本地联调/私有网关）。
    """
    raw = (endpoint or "").strip().rstrip("/")
    if "://" in raw:
        protocol, host = raw.split("://", 1)
        return protocol.lower(), host
    return "https", raw


@dataclass(frozen=True)
class Settings:
    """运行期配置（不可变）。"""

    access_key_id: str
    access_key_secret: str
    endpoints: Tuple[Tuple[str, str], ...]

    # 限流与超时（业务硬约束：单用户/全局调用速率不得超过 10 次/秒）
    qps_limit: int = 10
    probe_timeout_seconds: float = 3.0
    probe_cache_seconds: float = 300.0
    degraded_recovery_seconds: float = 60.0
    api_connect_timeout_ms: int = 3000
    api_read_timeout_ms: int = 10000
    api_max_retries: int = 2
    retry_base_delay_seconds: float = 0.5

    # 队列与任务
    queue_capacity: int = 1000
    queue_max_wait_seconds: float = 120.0
    queue_warn_depth: int = 50
    task_timeout_seconds: float = 15.0
    audit_timeout_seconds: float = 18.0
    worker_concurrency: int = 16

    # 输入限制
    max_images: int = 9
    max_text_chars: int = 2000
    max_image_bytes: int = 20 * 1024 * 1024
    image_fetch_timeout_seconds: float = 3.0
    image_preflight_enabled: bool = True

    # 审核智能体 AppID
    multimodal_app_id: str = DEFAULT_MULTIMODAL_APP_ID
    image_app_id: str = DEFAULT_IMAGE_APP_ID
    text_app_id: str = DEFAULT_TEXT_APP_ID

    # 可选：标准审核兜底（广告/敏感检测）
    standard_check_enabled: bool = False
    standard_text_service: str = "comment_detection_pro"
    standard_image_service: str = "baselineCheck"

    # 运维
    log_level: str = "INFO"
    webhook_url: str = ""
    webhook_timeout_seconds: float = 3.0
    # 可选共享令牌：配置后 /audit 必须携带 x-moderation-token
    service_token: str = ""

    # 仅测试环境允许访问内网图片 URL（用于本地 mock，生产永远为 False）
    app_env: str = "production"
    test_allow_private_image_urls: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        app_env = _env_str("APP_ENV", "production").lower()
        allow_private = (
            app_env == "test" and _env_bool("TEST_ALLOW_PRIVATE_IMAGE_URLS", False)
        )
        return cls(
            access_key_id=_env_str("ALIBABA_CLOUD_ACCESS_KEY_ID"),
            access_key_secret=_env_str("ALIBABA_CLOUD_ACCESS_KEY_SECRET"),
            endpoints=_parse_endpoints(_env_str("MODERATION_ENDPOINTS")),
            qps_limit=max(1, min(_env_int("MODERATION_QPS_LIMIT", 10), 10)),
            probe_timeout_seconds=_env_float("MODERATION_PROBE_TIMEOUT", 3.0),
            probe_cache_seconds=_env_float("MODERATION_PROBE_CACHE_SECONDS", 300.0),
            degraded_recovery_seconds=_env_float(
                "MODERATION_DEGRADED_RECOVERY_SECONDS", 60.0
            ),
            api_connect_timeout_ms=_env_int(
                "MODERATION_API_CONNECT_TIMEOUT_MS", 3000
            ),
            api_read_timeout_ms=_env_int("MODERATION_API_READ_TIMEOUT_MS", 10000),
            api_max_retries=max(0, _env_int("MODERATION_API_MAX_RETRIES", 2)),
            retry_base_delay_seconds=_env_float(
                "MODERATION_RETRY_BASE_DELAY_SECONDS", 0.5
            ),
            queue_capacity=max(1, _env_int("MODERATION_QUEUE_CAPACITY", 1000)),
            queue_max_wait_seconds=_env_float(
                "MODERATION_QUEUE_MAX_WAIT_SECONDS", 120.0
            ),
            queue_warn_depth=max(1, _env_int("MODERATION_QUEUE_WARN_DEPTH", 50)),
            task_timeout_seconds=_env_float("MODERATION_TASK_TIMEOUT_SECONDS", 15.0),
            audit_timeout_seconds=_env_float("MODERATION_AUDIT_TIMEOUT_SECONDS", 18.0),
            worker_concurrency=max(1, _env_int("MODERATION_WORKER_CONCURRENCY", 16)),
            max_images=max(1, min(_env_int("MODERATION_MAX_IMAGES", 9), 9)),
            max_text_chars=max(1, _env_int("MODERATION_MAX_TEXT_CHARS", 2000)),
            max_image_bytes=max(
                1, _env_int("MODERATION_MAX_IMAGE_BYTES", 20 * 1024 * 1024)
            ),
            image_fetch_timeout_seconds=_env_float(
                "MODERATION_IMAGE_FETCH_TIMEOUT_SECONDS", 3.0
            ),
            image_preflight_enabled=_env_bool(
                "MODERATION_IMAGE_PREFLIGHT_ENABLED", True
            ),
            multimodal_app_id=_env_str(
                "MODERATION_MULTIMODAL_APP_ID", DEFAULT_MULTIMODAL_APP_ID
            ),
            image_app_id=_env_str("MODERATION_IMAGE_APP_ID", DEFAULT_IMAGE_APP_ID),
            text_app_id=_env_str("MODERATION_TEXT_APP_ID", DEFAULT_TEXT_APP_ID),
            standard_check_enabled=_env_bool(
                "MODERATION_STANDARD_CHECK_ENABLED", False
            ),
            standard_text_service=_env_str(
                "MODERATION_STANDARD_TEXT_SERVICE", "comment_detection_pro"
            ),
            standard_image_service=_env_str(
                "MODERATION_STANDARD_IMAGE_SERVICE", "baselineCheck"
            ),
            log_level=_env_str("LOG_LEVEL", "INFO").upper(),
            webhook_url=_env_str("MODERATION_WEBHOOK_URL"),
            webhook_timeout_seconds=_env_float("MODERATION_WEBHOOK_TIMEOUT", 3.0),
            service_token=_env_str("MODERATION_SERVICE_TOKEN").strip(),
            app_env=app_env,
            test_allow_private_image_urls=allow_private,
        )

    @property
    def credentials_ready(self) -> bool:
        """AK/SK 是否齐备（只返回布尔值，绝不返回密钥内容）。"""
        return bool(self.access_key_id and self.access_key_secret)

    @property
    def ak_ready(self) -> bool:
        return bool(self.access_key_id)

    @property
    def sk_ready(self) -> bool:
        return bool(self.access_key_secret)

    @property
    def allow_private_image_urls(self) -> bool:
        return self.test_allow_private_image_urls
