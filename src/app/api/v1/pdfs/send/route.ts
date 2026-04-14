import { supabase } from '@/lib/supabase'
import { pushMessage } from '@/lib/line'
import { getOrCreateShortCode } from '@/lib/short-code'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const { pdfIds, recipientId } = await request.json() as {
    pdfIds: string[]
    recipientId: string
  }

  if (!pdfIds?.length || !recipientId) {
    return Response.json({ error: 'pdfIds と recipientId は必須です' }, { status: 400 })
  }

  const { data: recipient } = await supabase
    .from('recipients')
    .select('*')
    .eq('id', recipientId)
    .maybeSingle()

  if (!recipient) {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }

  const { data: pdfs } = await supabase
    .from('pdf_documents')
    .select('id, originalFileName, personName, storageBucket, storagePath')
    .in('id', pdfIds)

  if (!pdfs || pdfs.length === 0) {
    return Response.json({ error: 'PDFが見つかりません' }, { status: 404 })
  }

  const results: { fileName: string; ok: boolean; error?: string }[] = []

  for (const pdf of pdfs) {
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : request.nextUrl.origin
    const shortCode = await getOrCreateShortCode(pdf.id)
    const dlLink = `${baseUrl}/dl/${shortCode}`

    const name = pdf.personName || pdf.originalFileName
    const text = `${name} の給与明細です。\n${dlLink}`

    const res = await pushMessage(recipient.lineUserId, [{ type: 'text', text }])
    results.push({ fileName: pdf.originalFileName, ok: res.ok, error: res.error })
  }

  const success = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  return Response.json({ success, failed, results })
}
