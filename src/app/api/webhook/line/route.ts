import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('x-line-signature')
  const secret = process.env.LINE_CHANNEL_SECRET

  if (secret && signature) {
    const hash = crypto
      .createHmac('SHA256', secret)
      .update(body)
      .digest('base64')
    if (hash !== signature) {
      return Response.json({ error: 'Invalid signature' }, { status: 403 })
    }
  }

  const payload = JSON.parse(body)
  const events = payload.events || []

  for (const event of events) {
    const userId = event.source?.userId
    if (!userId) continue

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
    if (!token) continue

    const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    let displayName = userId
    if (profileRes.ok) {
      const profile = await profileRes.json()
      displayName = profile.displayName || userId
    }

    await supabase
      .from('recipients')
      .upsert(
        { lineUserId: userId, displayName, isActive: true },
        { onConflict: 'lineUserId' },
      )
  }

  return Response.json({ ok: true })
}
