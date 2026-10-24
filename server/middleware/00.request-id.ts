import { randomUUID } from 'node:crypto'

export default defineEventHandler((event) => {
  const incomingRequestId = getHeader(event, 'x-request-id')
  const trimmed = incomingRequestId ? incomingRequestId.trim() : ''
  // 只接受受限字符集，避免把任意请求头原样回写（控制字符会让 setHeader 抛错）
  const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(trimmed) ? trimmed : randomUUID()

  event.context.requestId = requestId
  setHeader(event, 'x-request-id', requestId)
})
