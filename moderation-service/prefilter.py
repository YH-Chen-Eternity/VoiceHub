"""前置规则过滤与可选的标准审核兜底。

两层：
1. 本地正则：手机号 / URL / 邮箱 / 身份证号。命中直接视为 high，跳过智能体调用。
2. 可选标准审核：阿里云 TextModeration / ImageModeration 的广告、敏感内容检测，
   判黑直接视为 high。默认关闭（MODERATION_STANDARD_CHECK_ENABLED=true 开启）。

【业务硬约束】正则命中属于高风险，不得降级为 PASS；标准审核判黑同理。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

# 手机号（中国大陆，边界避免误匹配身份证中的连续数字）
PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
# 链接：http(s) 或 www 开头
URL_RE = re.compile(r"https?://[^\s]+|www\.[^\s]+", re.IGNORECASE)
# 邮箱
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# 18 位身份证号（含末位 X）
ID_CARD_RE = re.compile(
    r"(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)"
)

# 配文出现这些特征时，九宫格采用“配文+图片”图文混合审核；
# 中性配文只做纯图片审核，避免 9 倍文本重复计费。
_SUSPICIOUS_TEXT_RE = re.compile(
    r"(代购|刷单|裸聊|约炮|开房|欺凌|霸凌|丑化|人肉|威胁|恐吓|自杀|毒品|赌博|博彩|"
    r"加微信|加我微信|加V|私聊我|联系方式|二维码|扫码|返利|兼职日结)",
    re.IGNORECASE,
)
_CONTACT_HINT_RE = re.compile(
    r"(微信|weixin|wechat|vx|wx|qq|扣扣|telegram|飞机|电话|手机号|联系方式)"
    r"[\s:：\-]{0,3}[A-Za-z0-9_\-]{5,}",
    re.IGNORECASE,
)

PASS_LABELS = {"nonlabel", "pass", "normal", "non_label"}


@dataclass
class PrefilterResult:
    """前置过滤结果。"""

    intercepted: bool = False
    reason: str = ""
    matched_rule: str = ""
    standard_labels: List[str] = field(default_factory=list)


def prefilter(text: str, image_urls: Optional[Sequence[str]] = None) -> Tuple[bool, str]:
    """本地正则前置过滤。

    入参：
        text: 帖子配文。
        image_urls: 图片地址列表（本层不校验，仅为兼容统一签名）。
    返回：
        (intercepted, reason)。intercepted=True 表示命中高风险规则，
        调用方必须直接返回 MANUAL_REVIEW，禁止继续调用智能体接口。
    """
    content = text or ""
    checks = (
        ("PHONE", PHONE_RE, "命中手机号规则"),
        ("URL", URL_RE, "命中链接规则"),
        ("EMAIL", EMAIL_RE, "命中邮箱规则"),
        ("ID_CARD", ID_CARD_RE, "命中身份证号规则"),
    )
    for _name, pattern, reason in checks:
        if pattern.search(content):
            return True, reason
    return False, ""


def is_risky_text(text: str) -> bool:
    """判断配文是否属于“可疑文本”，用于决定是否做图文混合审核。

    该判断只影响调用方式（是否附带 content），不直接决定最终处置。
    """
    content = (text or "").strip()
    if not content:
        return False
    if _SUSPICIOUS_TEXT_RE.search(content):
        return True
    if _CONTACT_HINT_RE.search(content):
        return True
    # 长文本且包含大量符号/重复字符时，按可疑处理，交给多模态复核。
    if len(content) > 40:
        symbols = sum(1 for ch in content if not ch.isalnum() and not ch.isspace())
        if symbols / max(len(content), 1) > 0.35:
            return True
    return False


async def prefilter_with_standard(
    client, text: str, image_urls: Optional[Sequence[str]] = None
) -> PrefilterResult:
    """正则 + 可选标准审核兜底。

    client 需提供：
        - settings.standard_check_enabled
        - async standard_text_check(text) -> (hit, labels)
        - async standard_image_check(url) -> (hit, labels)
    标准审核失败不阻断流程（不误杀），但若因此导致服务降级，
    由流水线在后续步骤返回 API_UNAVAILABLE。
    """
    intercepted, reason = prefilter(text, image_urls)
    if intercepted:
        rule = reason.split("规则")[0].replace("命中", "") or "REGEX"
        return PrefilterResult(
            intercepted=True, reason=reason, matched_rule=rule
        )

    settings = getattr(client, "settings", None)
    if settings is None or not getattr(settings, "standard_check_enabled", False):
        return PrefilterResult()

    labels: List[str] = []
    content = (text or "").strip()
    if content:
        hit, text_labels = await client.standard_text_check(content)
        if hit:
            labels.extend(text_labels or ["STANDARD_TEXT"])
            return PrefilterResult(
                intercepted=True,
                reason="标准审核判黑（文本广告/敏感内容）",
                matched_rule="STANDARD_TEXT",
                standard_labels=labels,
            )

    for url in image_urls or []:
        hit, image_labels = await client.standard_image_check(url)
        if hit:
            labels.extend(image_labels or ["STANDARD_IMAGE"])
            return PrefilterResult(
                intercepted=True,
                reason="标准审核判黑（图片广告/敏感内容）",
                matched_rule="STANDARD_IMAGE",
                standard_labels=labels,
            )

    return PrefilterResult()
