import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

function verifySignature(body: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret) {
    // secret 未設定だと全リクエストを拒否してしまうため、無言ではなく明示的に警告する
    console.error('[webhook] LINE_CHANNEL_SECRET is not set; rejecting all webhook requests')
    return false
  }
  if (!signature) return false
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

// 業務フロー(workflow-system)へ postback イベントを転送する。
// LINE チャネルは workflow-system と共有しており、Webhook は当アプリが専有しているため、
// 当アプリでは扱わない postback（業務フローの承認操作など）だけを転送して肩代わりする。
// 設定（URL/シークレット）が無ければ何もしない＝当アプリ単体の動作は一切変わらない。
async function forwardPostbackToWorkflow(event: {
  source?: { userId?: string }
  postback?: { data?: string }
  replyToken?: string
}): Promise<void> {
  const url = process.env.WORKFLOW_POSTBACK_URL
  const secret = process.env.WORKFLOW_FORWARD_SECRET
  if (!url || !secret) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wf-forward-secret': secret },
      body: JSON.stringify({
        userId: event.source?.userId,
        data: event.postback?.data,
        replyToken: event.replyToken,
      }),
    })
  } catch (e) {
    console.error('[webhook] workflow postback forward failed:', e)
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
    // postback（業務フローの承認操作など）は当システムでは扱わず workflow-system へ転送する。
    // 従来 postback は実質無処理だったため、既存の recipient 登録フローには影響しない。
    if (event.type === 'postback') {
      await forwardPostbackToWorkflow(event)
      continue
    }

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
