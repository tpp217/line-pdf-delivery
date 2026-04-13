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
  if (!token) return Response.json({ ok: true })

  for (const event of events) {
    // グループ参加イベント
    if (event.type === 'join' && event.source?.type === 'group') {
      const groupId = event.source.groupId
      if (!groupId) continue

      const { data: existing } = await supabase
        .from('recipients')
        .select('id')
        .eq('lineUserId', groupId)
        .maybeSingle()

      if (existing) {
        await supabase.from('recipients').update({ isActive: true }).eq('id', existing.id)
        console.log(`[webhook] Group activated: ${groupId}`)
        continue
      }

      const summaryRes = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      let groupName = 'グループ'
      if (summaryRes.ok) {
        const summary = await summaryRes.json()
        groupName = summary.groupName || groupName
      }

      await supabase.from('recipients').insert({
        lineUserId: groupId,
        displayName: groupName,
        isActive: true,
        type: 'group',
      })
      console.log(`[webhook] Group registered: ${groupName} (${groupId})`)
      continue
    }

    // グループ内メッセージ → グループを登録
    if (event.source?.type === 'group' && event.source?.groupId) {
      const groupId = event.source.groupId

      const { data: existing } = await supabase
        .from('recipients')
        .select('id')
        .eq('lineUserId', groupId)
        .maybeSingle()

      if (!existing) {
        const summaryRes = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        let groupName = 'グループ'
        if (summaryRes.ok) {
          const summary = await summaryRes.json()
          groupName = summary.groupName || groupName
        }
        await supabase.from('recipients').insert({
          lineUserId: groupId,
          displayName: groupName,
          isActive: true,
          type: 'group',
        })
        console.log(`[webhook] Group registered via message: ${groupName} (${groupId})`)
      }
    }

    // 個人ユーザー
    const userId = event.source?.userId
    if (!userId) continue

    const { data: existing } = await supabase
      .from('recipients')
      .select('id')
      .eq('lineUserId', userId)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('recipients')
        .update({ isActive: true })
        .eq('id', existing.id)
      console.log(`[webhook] Already registered, activated: ${userId}`)
      continue
    }

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
      .insert({ lineUserId: userId, displayName, isActive: true, type: 'user' })

    console.log(`[webhook] New registered: ${displayName} (${userId})`)
  }

  return Response.json({ ok: true })
}
