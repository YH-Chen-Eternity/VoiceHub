/* Modified by YH-Chen-Eternity on 2026-10-23 */

import { createError, defineEventHandler, getQuery } from 'h3'
import { randomBytes } from 'node:crypto'

// 存储活跃的连接及其ID
const connections = new Map()

// 为每个操作生成唯一ID（加密随机，不可预测）
export function generateProgressId() {
  return `progress_${Date.now()}_${randomBytes(8).toString('hex')}`
}

// 通过ID发送进度更新
export function sendProgressUpdate(id: string, data: any) {
  const connection = connections.get(id)
  if (connection) {
    const eventData = JSON.stringify(data)
    connection.write(`data: ${eventData}\n\n`)
  }
}

// 完成进度并关闭连接
export function completeProgress(id: string, data: any) {
  const connection = connections.get(id)
  if (connection) {
    const eventData = JSON.stringify({
      ...data,
      completed: true
    })
    connection.write(`data: ${eventData}\n\n`)

    // 给浏览器一点时间处理最后的消息
    setTimeout(() => {
      connection.write('event: close\ndata: closed\n\n')
      connections.delete(id)
    }, 100)
  }
}

// 发送错误并关闭连接
export function sendProgressError(id: string, error: string) {
  const connection = connections.get(id)
  if (connection) {
    const eventData = JSON.stringify({
      error,
      completed: true
    })
    connection.write(`data: ${eventData}\n\n`)

    // 给浏览器一点时间处理错误消息
    setTimeout(() => {
      connection.write('event: close\ndata: closed\n\n')
      connections.delete(id)
    }, 100)
  }
}

// SSE端点处理程序
export default defineEventHandler(async (event) => {
  // 获取进度ID
  const query = getQuery(event)
  const id = query.id as string

  if (!id) {
    throw createError({
      statusCode: 400,
      message: '缺少进度ID'
    })
  }

  // 认证与授权统一走中间件已校验的 event.context.user（含 tokenVersion 撤销与
  // 会话表校验）。2026-10-23 安全加固：原实现用 jsonwebtoken 裸验 JWT_SECRET 且
  // 用户查询写成 Prisma 风格（db.user.findUnique 在 drizzle 下必然抛错→401），
  // 既让功能失效，又埋下绕过会话撤销体系的通道；现已对齐主认证体系。
  const user = event.context.user
  if (!user) {
    throw createError({
      statusCode: 401,
      message: '未授权访问'
    })
  }

  if (!['SONG_ADMIN', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw createError({
      statusCode: 403,
      message: '需要管理员权限'
    })
  }

  // 设置SSE头
  const response = event.node.res
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // 禁用Nginx缓冲
  })

  // 发送初始连接成功消息
  response.write(`data: ${JSON.stringify({ connected: true, id })}\n\n`)

  // 存储连接
  connections.set(id, response)

  // 监听客户端断开连接
  response.on('close', () => {
    connections.delete(id)
  })

  // 保持连接打开，直到客户端断开
  event.node.req.on('close', () => {
    connections.delete(id)
  })

  // 定期发送心跳以保持连接
  const heartbeatInterval = setInterval(() => {
    if (connections.has(id)) {
      response.write(': heartbeat\n\n')
    } else {
      clearInterval(heartbeatInterval)
    }
  }, 30000) // 每30秒发送一次心跳
})
