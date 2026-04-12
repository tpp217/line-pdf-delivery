const LINE_API_BASE = 'https://api.line.me/v2/bot'

export async function pushMessage(
  lineUserId: string,
  messages: { type: string; text?: string; originalContentUrl?: string; previewImageUrl?: string }[],
): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return { ok: false, error: 'LINE_CHANNEL_ACCESS_TOKEN が未設定です' }

  const res = await fetch(`${LINE_API_BASE}/message/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages,
    }),
  })

  const requestId = res.headers.get('x-line-request-id') || undefined

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { ok: false, requestId, error: body.message || `LINE API error: ${res.status}` }
  }

  return { ok: true, requestId }
}
