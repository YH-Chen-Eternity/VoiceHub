const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * 公告等公开链接/图片地址的协议校验：仅允许 http(s) 绝对地址或站内相对路径。
 * 控制字符与反斜杠一律拒绝，避免浏览器归一化后变成协议相对地址（//evil.com）。
 */
export function isSafePublicUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const input = value.trim()
  if (!input) return true
  if (/[\u0000-\u001f\u007f\\]/.test(input)) return false
  if (input.startsWith('//')) return false
  if (input.startsWith('/')) return true

  try {
    const url = new URL(input)
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}
