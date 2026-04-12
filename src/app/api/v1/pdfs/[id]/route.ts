import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('pdf_documents')
    .select('*')
    .eq('id', id)
    .is('deletedAt', null)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'PDFが見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const body = await request.json()
  const { companyNameManual, personNameManual } = body

  const updates: Record<string, unknown> = {}
  if (companyNameManual !== undefined) updates.companyNameManual = companyNameManual
  if (personNameManual !== undefined) updates.personNameManual = personNameManual

  const { data, error } = await supabase
    .from('pdf_documents')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'PDFが見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params

  const { data: doc } = await supabase
    .from('pdf_documents')
    .select('storageBucket, storagePath')
    .eq('id', id)
    .maybeSingle()

  if (doc) {
    await supabase.storage.from(doc.storageBucket).remove([doc.storagePath])
  }

  const { error } = await supabase
    .from('pdf_documents')
    .update({ deletedAt: new Date().toISOString() })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
