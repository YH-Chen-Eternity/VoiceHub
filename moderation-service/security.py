"""URL 安全校验、日志脱敏与图片预检。

安全目标：
1. 仅允许 http/https，禁止内网/回环/链路本地/保留地址，防止 SSRF。
2. 日志中不出现完整 URL（其中可能包含签名 token），只记录脱敏后的地址。
3. 图片预检：3 秒超时、单张不超过 20MB，失败则该图标记 failed。
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

import httpx

# 除 ipaddress 自带属性外，额外显式封禁的网段（云元数据、CGNAT、保留地址等）。
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),  # CGNAT
    ipaddress.ip_network("169.254.0.0/16"),  # 链路本地 / 云元数据
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("255.255.255.255/32"),
    ipaddress.ip_network("fc00::/7"),  # IPv6 ULA
    ipaddress.ip_network("fe80::/10"),  # IPv6 链路本地
    ipaddress.ip_network("2001:db8::/32"),
]

_BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "metadata",
    "metadata.google.internal",
    "instance-data",
}

MAX_URL_LENGTH = 2048
USER_AGENT = "community-moderation-service/1.0"

_dns_cache: Dict[str, Tuple[float, List[str]]] = {}
_dns_lock = asyncio.Lock()
_DNS_CACHE_SECONDS = 60.0


def _is_public_ip(ip: ipaddress._BaseAddress) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    return not any(ip in network for network in _BLOCKED_NETWORKS)


def validate_image_url(
    url: str, allow_private: bool = False
) -> Tuple[bool, str]:
    """同步校验 URL 格式与字面量地址。

    返回 (是否合法, 失败原因)。主机名解析在 :func:`validate_image_url_resolved`
    中完成，避免阻塞事件循环。
    """
    if not isinstance(url, str):
        return False, "URL 必须是字符串"
    url = url.strip()
    if not url:
        return False, "URL 为空"
    if len(url) > MAX_URL_LENGTH:
        return False, "URL 长度超过 2048"
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False, "URL 格式非法"

    if parsed.scheme.lower() not in {"http", "https"}:
        return False, "仅允许 http/https"
    if parsed.username or parsed.password:
        return False, "URL 不允许包含用户凭证"
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return False, "URL 缺少主机名"
    if host in _BLOCKED_HOSTNAMES or host.endswith(".local"):
        return False, "禁止访问本机/内网主机"
    if allow_private:
        return True, ""

    # 主机名为 IP 字面量时直接判断，避免 DNS 解析。
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and not _is_public_ip(ip):
        return False, "禁止访问内网/保留地址"
    return True, ""


async def _resolve_host(host: str, port: int) -> List[str]:
    """解析主机名并缓存结果；失败抛 OSError。"""
    cache_key = "%s:%s" % (host.lower(), port)
    now = time.monotonic()
    async with _dns_lock:
        cached = _dns_cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses = []
    for item in infos:
        addr = item[4][0]
        if addr not in addresses:
            addresses.append(addr)
    if not addresses:
        raise OSError("DNS 解析结果为空")
    async with _dns_lock:
        _dns_cache[cache_key] = (now + _DNS_CACHE_SECONDS, addresses)
    return addresses


async def validate_image_url_resolved(
    url: str, allow_private: bool = False, timeout_seconds: float = 3.0
) -> Tuple[bool, str]:
    """在同步校验基础上做 DNS 解析，防止解析到内网地址（基础 SSRF 防护）。"""
    ok, reason = validate_image_url(url, allow_private=allow_private)
    if not ok:
        return ok, reason
    if allow_private:
        return True, ""

    parsed = urlsplit(url)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    try:
        addresses = await asyncio.wait_for(
            _resolve_host(host, port), timeout=timeout_seconds
        )
    except (asyncio.TimeoutError, socket.gaierror, OSError):
        return False, "域名解析失败或超时"

    for addr in addresses:
        try:
            ip = ipaddress.ip_address(addr.split("%")[0])
        except ValueError:
            return False, "域名解析到非法地址"
        if not _is_public_ip(ip):
            return False, "域名解析到内网/保留地址"
    return True, ""


def clear_dns_cache() -> None:
    """测试辅助：清空 DNS 缓存。"""
    _dns_cache.clear()


def redact_url(url: str, max_length: int = 80) -> str:
    """移除 URL 中的凭证、查询参数与锚点，仅保留可定位的短地址。

    日志中严禁输出带签名 token 的完整 URL。
    """
    if not url:
        return ""
    try:
        parsed = urlsplit(url)
    except ValueError:
        return "<invalid-url>"
    host = parsed.hostname or ""
    port = ""
    try:
        if parsed.port:
            port = ":%d" % parsed.port
    except ValueError:
        port = ""
    path = parsed.path or ""
    if len(path) > 40:
        path = path[:37] + "..."
    return urlunsplit((parsed.scheme, host + port, path, "", ""))


def _parse_content_length(headers: httpx.Headers) -> Optional[int]:
    content_range = headers.get("content-range", "")
    if "/" in content_range:
        total = content_range.rsplit("/", 1)[-1].strip()
        if total.isdigit():
            return int(total)
    content_length = headers.get("content-length", "")
    if content_length.isdigit():
        return int(content_length)
    return None


async def preflight_image(
    url: str, timeout_seconds: float, max_bytes: int
) -> Tuple[bool, str]:
    """下载预检：确认图片可访问、未超时、大小不超过限制。

    使用 Range 请求只读取首块数据，避免把整张图拉到本地。
    返回 (是否通过, 失败原因)；失败时该图片应标记为 failed。
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Range": "bytes=0-0",
        "Accept": "image/*,*/*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            async with client.stream("GET", url, headers=headers) as response:
                status = response.status_code
                # 重定向由阿里云侧继续处理，这里只确认源站可达。
                if 300 <= status < 400:
                    return True, ""
                if status >= 400:
                    return False, "图片下载失败（HTTP %d）" % status
                total = _parse_content_length(response.headers)
                if total is not None and total > max_bytes:
                    return False, "图片超过 %dMB" % (max_bytes // (1024 * 1024))
                received = 0
                async for chunk in response.aiter_bytes():
                    received += len(chunk)
                    if received > max_bytes:
                        return False, "图片超过 %dMB" % (max_bytes // (1024 * 1024))
                    break  # Range 只取首块，确认可读取即可
        return True, ""
    except httpx.TimeoutException:
        return False, "图片下载超时"
    except httpx.HTTPError as exc:
        return False, "图片下载失败（%s）" % type(exc).__name__
    except Exception as exc:  # noqa: BLE001 - 预检失败一律按失败处理
        return False, "图片下载异常（%s）" % type(exc).__name__
