import { supabase } from '@/lib/supabase'
import { pushMessage } from '@/lib/line'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'
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
 *     text: string,              // 送信する本文（URLなどを含む単純テキスト）
 *     source?: string,           // 呼び出し元識別（省略時 "external"）。バッチタイトルに使用
 *     tenant_id?: string         // テナント分離: 対象テナント。省略時は DEFAULT_TENANT_ID(utinc)
 *   }
 *
 * テナント分離:
 *   この入口は JWT を持たないサーバー間呼び出し（template-library など）用。
 *   宛先の引当・バッチ/ジョブ/イベントの作成はすべて解決した tenant_id に閉じる。
 *   呼び出し側が tenant_id を渡さない現状（テナント=utinc のみ）では DEFAULT_TENANT_ID
 *   にフォールバックする＝既存挙動を壊さない。テナントが増えたら呼び出し側で
 *   x-tenant-id ヘッダ or body.tenant_id を明示する。
 *
 * Returns:
 *   {
 *     success: number,
 *     failed: number,
 *     batchId: string,
 *     results: [{ recipientId, displayName, ok, error? }]
 *   }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const recipientIds: string[] = Array.isArray(body?.recipient_ids)
    ? body.recipient_ids.filter((v: unknown) => typeof v === 'string')
    : []
  const text: string = typeof body?.text === 'string' ? body.text : ''
  const source: string = typeof body?.source === 'string' && body.source.trim()
    ? body.source.trim()
    : 'external'

  // テナント解決: body.tenant_id / x-tenant-id ヘッダ → 無ければ既定(utinc)。
  const headerTenant = (request.headers.get('x-tenant-id') ?? '').trim()
  const bodyTenant = typeof body?.tenant_id === 'string' ? body.tenant_id.trim() : ''
  const tenantId = bodyTenant || headerTenant || DEFAULT_TENANT_ID

  if (recipientIds.length === 0) {
    return Response.json({ error: 'recipient_ids は必須です' }, { status: 400 })
  }
  if (!text.trim()) {
    return Response.json({ error: 'text は必須です' }, { status: 400 })
  }

  const { data: recipients, error } = await supabase
    .from('recipients')
    .select('id, displayName, lineUserId, isActive')
    .eq('tenant_id', tenantId)
    .in('id', recipientIds)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!recipients || recipients.length === 0) {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }

  // バッチ作成
  const totalJobs = recipients.length
  const preview = text.length > 30 ? `${text.slice(0, 30)}…` : text
  const batchTitle = `テキスト送信(${source}): ${preview}`
  const { data: batch, error: batchErr } = await supabase
    .from('send_batches')
    .insert({ tenant_id: tenantId, title: batchTitle, status: 'PROCESSING', totalJobs, startedAt: new Date().toISOString() })
    .select('id')
    .single()
  if (batchErr || !batch) {
    return Response.json({ error: `バッチ作成失敗: ${batchErr?.message}` }, { status: 500 })
  }

  const results: {
    recipientId: string
    displayName: string
    ok: boolean
    error?: string
  }[] = []

  for (const r of recipients) {
    const { data: job } = await supabase
      .from('send_jobs')
      .insert({
        tenant_id: tenantId,
        sendBatchId: batch.id,
        pdfDocumentId: null,
        recipientId: r.id,
        status: 'PENDING',
        messageBody: text,
      })
      .select('id')
      .single()

    if (!r.isActive) {
      if (job) {
        await supabase
          .from('send_jobs')
          .update({ status: 'FAILED', errorMessage: '無効化されている宛先' })
          .eq('tenant_id', tenantId)
          .eq('id', job.id)
        await supabase.from('delivery_events').insert({
          tenant_id: tenantId,
          sendJobId: job.id,
          eventType: 'FAILED',
          payload: { reason: 'inactive_recipient' },
        })
      }
      results.push({
        recipientId: r.id,
        displayName: r.displayName,
        ok: false,
        error: '無効化されている宛先',
      })
      continue
    }

    const res = await pushMessage(r.lineUserId, [{ type: 'text', text }])

    if (job) {
      if (res.ok) {
        await supabase
          .from('send_jobs')
          .update({ status: 'SENT', sentAt: new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('id', job.id)
        await supabase.from('delivery_events').insert({
          tenant_id: tenantId,
          sendJobId: job.id,
          eventType: 'SENT',
          payload: null,
        })
      } else {
        await supabase
          .from('send_jobs')
          .update({ status: 'FAILED', errorMessage: res.error ?? 'unknown' })
          .eq('tenant_id', tenantId)
          .eq('id', job.id)
        await supabase.from('delivery_events').insert({
          tenant_id: tenantId,
          sendJobId: job.id,
          eventType: 'FAILED',
          payload: { error: res.error },
        })
      }
    }

    results.push({
      recipientId: r.id,
      displayName: r.displayName,
      ok: res.ok,
      error: res.error,
    })
  }

  const success = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  await supabase
    .from('send_batches')
    .update({
      status: failed === 0 ? 'COMPLETED' : success === 0 ? 'FAILED' : 'PARTIAL',
      successJobs: success,
      failedJobs: failed,
      completedAt: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', batch.id)

  return Response.json({ success, failed, batchId: batch.id, results })
}
