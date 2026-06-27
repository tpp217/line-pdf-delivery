import { supabase } from '@/lib/supabase'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { data, error } = await supabase
    .from('persons')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { name, categories } = await request.json()
  if (!name) return Response.json({ error: 'name は必須です' }, { status: 400 })

  // onConflict は (tenant_id, name) 複合 UNIQUE（migration で移行）に合わせる。
  const { data, error } = await supabase
    .from('persons')
    .upsert(
      { tenant_id: tenantId, name, categories: categories || [] },
      { onConflict: 'tenant_id,name' },
    )
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
