import { supabase } from '@/lib/supabase'
import { sanitizeLikePattern } from '@/lib/postgrest'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const isActive = searchParams.get('isActive')
  const isDefault = searchParams.get('isDefault')

  let query = supabase
    .from('recipients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('sortOrder', { ascending: true })
    .order('createdAt', { ascending: false })

  if (isActive !== null) query = query.eq('isActive', isActive === 'true')
  if (isDefault !== null) query = query.eq('isDefault', isDefault === 'true')
  if (keyword) {
    // .or() はフィルタ文字列を素で組み立てるため必ずサニタイズする（インジェクション対策）
    const safe = sanitizeLikePattern(keyword)
    if (safe) {
      query = query.or(`displayName.ilike.%${safe}%,memo.ilike.%${safe}%`)
    }
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const body = await request.json()
  const { displayName, lineUserId, memo, isActive, isDefault } = body

  if (!displayName || !lineUserId) {
    return Response.json(
      { error: 'displayName と lineUserId は必須です' },
      { status: 400 },
    )
  }

  const { data: existing } = await supabase
    .from('recipients')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('lineUserId', lineUserId)
    .maybeSingle()

  if (existing) {
    return Response.json(
      { error: 'この lineUserId は既に登録されています' },
      { status: 409 },
    )
  }

  // 新規は末尾に追加（テナント内の最大 sortOrder の次）
  const { data: maxRow } = await supabase
    .from('recipients')
    .select('sortOrder')
    .eq('tenant_id', tenantId)
    .order('sortOrder', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sortOrder ?? 0) + 1

  const { data, error } = await supabase
    .from('recipients')
    .insert({
      tenant_id: tenantId,
      displayName,
      lineUserId,
      memo: memo ?? null,
      isActive: isActive ?? true,
      isDefault: isDefault ?? false,
      sortOrder: nextOrder,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
