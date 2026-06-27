import { supabase } from '@/lib/supabase'
import { pushMessage } from '@/lib/line'
import { getOrCreateShortCode } from '@/lib/short-code'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

/**
 * PDF送信API（複数宛先対応）
 *
 * Body:
 *   {
 *     pdfIds: string[],
 *     recipient_ids: string[]
 *   }
 *
 * 互換: 旧形式の `recipientId: string` も受け付け、内部的に
 * `recipient_ids: [recipientId]` として扱う。
 *
 * Response:
 *   {
 *     success: number,
 *     failed: number,
 *     batchId: string,
 *     results: [
 *       { recipientId, displayName, fileName, ok, error? }
 *     ]
 *   }
 */
export async function POST(request: NextRequest) {
  // テナント分離: 宛先・PDF・バッチ・ジョブ・イベントすべてを呼び出し元 tenant に閉じる。
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const body = await request.json()

  const pdfIds: string[] = Array.isArray(body?.pdfIds)
    ? body.pdfIds.filter((v: unknown) => typeof v === 'string')
    : []

  const recipientIds: string[] = Array.isArray(body?.recipient_ids)
    ? body.recipient_ids.filter((v: unknown) => typeof v === 'string')
    : typeof body?.recipientId === 'string'
      ? [body.recipientId]
      : []

  if (pdfIds.length === 0) {
    return Response.json({ error: 'pdfIds は必須です' }, { status: 400 })
  }
  if (recipientIds.length === 0) {
    return Response.json(
      { error: 'recipient_ids は必須です' },
      { status: 400 },
    )
  }

  const { data: recipients, error: recErr } = await supabase
    .from('recipients')
    .select('id, displayName, lineUserId, isActive')
    .eq('tenant_id', tenantId)
    .in('id', recipientIds)

  if (recErr) {
    return Response.json({ error: recErr.message }, { status: 500 })
  }
  if (!recipients || recipients.length === 0) {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }

  const { data: pdfs } = await supabase
    .from('pdf_documents')
    .select('id, originalFileName, personName')
    .eq('tenant_id', tenantId)
    .in('id', pdfIds)
    .is('deletedAt', null)

  if (!pdfs || pdfs.length === 0) {
    return Response.json({ error: 'PDFが見つかりません' }, { status: 404 })
  }

  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : request.nextUrl.origin

  // 各PDFのダウンロードリンクを先に作っておく（同じPDFを複数宛先に送るため再利用）
  const links = await Promise.all(
    pdfs.map(async (pdf) => {
      const shortCode = await getOrCreateShortCode(pdf.id)
      return {
        id: pdf.id,
        fileName: pdf.originalFileName,
        title: pdf.personName || pdf.originalFileName,
        url: `${baseUrl}/dl/${shortCode}`,
      }
    }),
  )

  // 送信バッチを作成
  const totalJobs = recipients.length * links.length
  const batchTitle = `PDF送信: ${links.length}件×${recipients.length}宛先`
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
    fileName: string
    ok: boolean
    error?: string
  }[] = []

  for (const r of recipients) {
    for (const link of links) {
      const text = `${link.title} の給与明細です。\n${link.url}`

      // ジョブを PENDING で作成
      const { data: job } = await supabase
        .from('send_jobs')
        .insert({
          tenant_id: tenantId,
          sendBatchId: batch.id,
          pdfDocumentId: link.id,
          recipientId: r.id,
          status: 'PENDING',
          messageTitle: link.title,
          messageBody: text,
          signedUrl: link.url,
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
          fileName: link.fileName,
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
        fileName: link.fileName,
        ok: res.ok,
        error: res.error,
      })
    }
  }

  const success = results.filter((x) => x.ok).length
  const failed = results.filter((x) => !x.ok).length

  // バッチを完了状態に
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
