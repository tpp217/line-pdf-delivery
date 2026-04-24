import { supabase } from '@/lib/supabase'
import { pushMessage } from '@/lib/line'
import { NextRequest } from 'next/server'

/**
 * 汎用 LINE テキストメッセージ送信エンドポイント
 *
 * template-library など他プロジェクトから呼び出して、
 * 既存の recipients（LINE宛先）にテキストメッセージを配信する。
 *
 * Body:
 *   {
 *     recipient_ids: string[],   // recipients テーブルの id
 *     text: string                // 送信する本文（URLなどを含む単純テキスト）
 *   }
 *
 * Returns:
 *   {
 *     success: number,
 *     failed: number,
 *     results: [{ recipientId, displayName, ok, error? }]
 *   }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const recipientIds: string[] = Array.isArray(body?.recipient_ids)
    ? body.recipient_ids.filter((v: unknown) => typeof v === 'string')
    : []
  const text: string = typeof body?.text === 'string' ? body.text : ''

  if (recipientIds.length === 0) {
    return Response.json({ error: 'recipient_ids は必須です' }, { status: 400 })
  }
  if (!text.trim()) {
    return Response.json({ error: 'text は必須です' }, { status: 400 })
  }

  const { data: recipients, error } = await supabase
    .from('recipients')
    .select('id, displayName, lineUserId, isActive')
    .in('id', recipientIds)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!recipients || recipients.length === 0) {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }

  const results: {
    recipientId: string
    displayName: string
    ok: boolean
    error?: string
  }[] = []

  for (const r of recipients) {
    if (!r.isActive) {
      results.push({
        recipientId: r.id,
        displayName: r.displayName,
        ok: false,
        error: '無効化されている宛先',
      })
      continue
    }
    const res = await pushMessage(r.lineUserId, [{ type: 'text', text }])
    results.push({
      recipientId: r.id,
      displayName: r.displayName,
      ok: res.ok,
      error: res.error,
    })
  }

  const success = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  return Response.json({ success, failed, results })
}
