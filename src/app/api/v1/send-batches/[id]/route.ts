import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params

  const { data: batch, error: batchErr } = await supabase
    .from('send_batches')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (batchErr) return Response.json({ error: batchErr.message }, { status: 500 })
  if (!batch) return Response.json({ error: 'バッチが見つかりません' }, { status: 404 })

  const { data: jobs } = await supabase
    .from('send_jobs')
    .select('*, pdfDocument:pdf_documents(id, originalFileName, personName), recipient:recipients(id, displayName)')
    .eq('sendBatchId', id)
    .order('createdAt', { ascending: true })

  return Response.json({ ...batch, jobs: jobs || [] })
}
