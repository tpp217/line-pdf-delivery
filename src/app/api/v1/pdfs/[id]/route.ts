import { supabase } from '@/lib/supabase'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(req)
  if (!tenantId) return unauthenticatedTenant()

  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('pdf_documents')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('deletedAt', null)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'PDFが見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(request: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { id } = await ctx.params
  const body = await request.json()
  const { companyNameManual, personNameManual } = body

  const updates: Record<string, unknown> = {}
  if (companyNameManual !== undefined) updates.companyNameManual = companyNameManual
  if (personNameManual !== undefined) updates.personNameManual = personNameManual

  // 更新項目が無いリクエストは無意味な書き込みになるため早期に弾く
  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: '更新項目がありません（companyNameManual / personNameManual のいずれかが必要です）' },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('pdf_documents')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'PDFが見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(req)
  if (!tenantId) return unauthenticatedTenant()

  const { id } = await ctx.params

  const { data: doc } = await supabase
    .from('pdf_documents')
    .select('storageBucket, storagePath')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()

  if (doc) {
    await supabase.storage.from(doc.storageBucket).remove([doc.storagePath])
  }

  const { error } = await supabase
    .from('pdf_documents')
    .update({ deletedAt: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
