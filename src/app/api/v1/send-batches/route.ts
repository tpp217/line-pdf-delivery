import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status')

  let query = supabase
    .from('send_batches')
    .select('*')
    .order('createdAt', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const { title, items } = await request.json() as {
    title: string
    items: { pdfDocumentId: string; recipientIds: string[]; messageTitle?: string }[]
  }

  if (!title || !items || items.length === 0) {
    return Response.json({ error: 'title と items は必須です' }, { status: 400 })
  }

  const jobs = items.flatMap((item) =>
    item.recipientIds.map((rid) => ({
      pdfDocumentId: item.pdfDocumentId,
      recipientId: rid,
      messageTitle: item.messageTitle || null,
    })),
  )

  const { data: batch, error: batchErr } = await supabase
    .from('send_batches')
    .insert({
      title,
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

  const { error: jobErr } = await supabase
    .from('send_jobs')
    .insert(jobRows)

  if (jobErr) return Response.json({ error: jobErr.message }, { status: 500 })

  return Response.json(batch, { status: 201 })
}
