import { supabase } from '@/lib/supabase'
import { pushMessage } from '@/lib/line'
import { getOrCreateShortCode } from '@/lib/short-code'
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
 *     results: [
 *       { recipientId, displayName, fileName, ok, error? }
 *     ]
 *   }
 */
export async function POST(request: NextRequest) {
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

  const results: {
    recipientId: string
    displayName: string
    fileName: string
    ok: boolean
    error?: string
  }[] = []

  for (const r of recipients) {
    if (!r.isActive) {
      // 無効化されている宛先は全PDFをスキップ
      for (const link of links) {
        results.push({
          recipientId: r.id,
          displayName: r.displayName,
          fileName: link.fileName,
          ok: false,
          error: '無効化されている宛先',
        })
      }
      continue
    }

    for (const link of links) {
      const text = `${link.title} の給与明細です。\n${link.url}`
      const res = await pushMessage(r.lineUserId, [{ type: 'text', text }])
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

  return Response.json({ success, failed, results })
}
