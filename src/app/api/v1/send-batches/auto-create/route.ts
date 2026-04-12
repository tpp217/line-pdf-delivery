import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const { title, pdfIds } = await request.json() as {
    title: string
    pdfIds: string[]
  }

  if (!pdfIds || pdfIds.length === 0) {
    return Response.json({ error: 'pdfIds は必須です' }, { status: 400 })
  }

  const { data: pdfs } = await supabase
    .from('pdf_documents')
    .select('id, personName')
    .in('id', pdfIds)

  const { data: rules } = await supabase
    .from('routing_rules')
    .select('*, recipient:recipients(id, displayName)')
    .eq('isActive', true)
    .order('priority', { ascending: false })

  if (!pdfs || !rules) {
    return Response.json({ error: 'データ取得に失敗しました' }, { status: 500 })
  }

  type JobItem = { pdfDocumentId: string; recipientId: string; messageTitle: string | null }
  const jobs: JobItem[] = []
  const unmatched: string[] = []

  for (const pdf of pdfs) {
    const name = pdf.personName || ''
    const matched = rules.find((rule) => {
      switch (rule.matchType) {
        case 'EXACT': return name === rule.companyKey
        case 'CONTAINS': return name.includes(rule.companyKey) || rule.companyKey.includes(name)
        case 'REGEX': try { return new RegExp(rule.companyKey).test(name) } catch { return false }
        default: return false
      }
    })

    if (matched?.recipient) {
      jobs.push({
        pdfDocumentId: pdf.id,
        recipientId: matched.recipient.id,
        messageTitle: null,
      })
    } else {
      unmatched.push(name || pdf.id)
    }
  }

  if (jobs.length === 0) {
    return Response.json({
      error: 'マッチするルールが見つかりませんでした',
      unmatched,
    }, { status: 400 })
  }

  const { data: batch, error: batchErr } = await supabase
    .from('send_batches')
    .insert({
      title: title || `自動バッチ ${new Date().toLocaleString('ja-JP')}`,
      status: 'DRAFT',
      totalJobs: jobs.length,
    })
    .select()
    .single()

  if (batchErr) return Response.json({ error: batchErr.message }, { status: 500 })

  const jobRows = jobs.map((j) => ({
    sendBatchId: batch.id,
    pdfDocumentId: j.pdfDocumentId,
    recipientId: j.recipientId,
    messageTitle: j.messageTitle,
    status: 'PENDING',
    deliveryMode: 'PUSH',
  }))

  await supabase.from('send_jobs').insert(jobRows)

  return Response.json({
    batch,
    matched: jobs.length,
    unmatched,
  }, { status: 201 })
}
