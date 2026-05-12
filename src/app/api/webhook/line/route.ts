import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

function verifySignature(body: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature) return false
  try {
    const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64')
    const a = Buffer.from(hash)
    const b = Buffer.from(signature)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

async function nextSortOrder(): Promise<number> {
  const { data } = await supabase
    .from('recipients')
    .select('sortOrder')
    .order('sortOrder', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.sortOrder ?? 0) + 1
}

async function fetchGroupName(groupId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return 'グループ'
    const summary = await res.json()
    return summary.groupName || 'グループ'
  } catch {
    return 'グループ'
  }
}

async function fetchUserName(userId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return userId
    const profile = await res.json()
    return profile.displayName || userId
  } catch {
    return userId
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('x-line-signature')
  const secret = process.env.LINE_CHANNEL_SECRET

  if (!verifySignature(body, signature, secret)) {
    console.error('[webhook] Invalid signature')
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return Response.json({ ok: true })
  }

  const events = payload.events || []
  if (events.length === 0) {
    return Response.json({ ok: true })
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) {
    console.error('[webhook] LINE_CHANNEL_ACCESS_TOKEN is not set')
    return Response.json({ ok: true })
  }

  console.log(`[webhook] received ${events.length} event(s)`)

  for (const event of events) {
    const sourceType = event.source?.type

    // グループ／ルーム由来のイベント（join含む）
    if (sourceType === 'group' || sourceType === 'room') {
      const groupId = event.source.groupId || event.source.roomId
      if (!groupId) {
        console.log('[webhook] group event without id, skip')
        continue
      }

      const { data: existing } = await supabase
        .from('recipients')
        .select('id, isActive')
        .eq('lineUserId', groupId)
        .maybeSingle()

      if (existing) {
        if (!existing.isActive) {
          await supabase.from('recipients').update({ isActive: true }).eq('id', existing.id)
          console.log(`[webhook] Group reactivated: ${groupId}`)
        }
        continue
      }

      const groupName = sourceType === 'group' ? await fetchGroupName(groupId, token) : 'ルーム'
      const { error } = await supabase.from('recipients').insert({
        lineUserId: groupId,
        displayName: groupName,
        isActive: true,
        isDefault: false,
        type: sourceType,
        sortOrder: await nextSortOrder(),
      })
      if (error) {
        console.error(`[webhook] Group insert failed (${groupId}):`, error.message)
      } else {
        console.log(`[webhook] Group registered: ${groupName} (${groupId})`)
      }
      // グループ／ルーム由来のイベントは、発言者個人を recipient に追加しない
      continue
    }

    // 個人ユーザー由来のイベント（follow / message ほか）
    const userId = event.source?.userId
    if (!userId) {
      console.log('[webhook] event without userId, skip')
      continue
    }

    const { data: existing } = await supabase
      .from('recipients')
      .select('id, isActive')
      .eq('lineUserId', userId)
      .maybeSingle()

    if (existing) {
      if (!existing.isActive) {
        await supabase.from('recipients').update({ isActive: true }).eq('id', existing.id)
        console.log(`[webhook] User reactivated: ${userId}`)
      }
      continue
    }

    const displayName = await fetchUserName(userId, token)
    const { error } = await supabase.from('recipients').insert({
      lineUserId: userId,
      displayName,
      isActive: true,
      isDefault: false,
      type: 'user',
      sortOrder: await nextSortOrder(),
    })
    if (error) {
      console.error(`[webhook] User insert failed (${userId}):`, error.message)
    } else {
      console.log(`[webhook] User registered: ${displayName} (${userId})`)
    }
  }

  return Response.json({ ok: true })
}
