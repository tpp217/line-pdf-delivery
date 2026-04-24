import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const isActive = searchParams.get('isActive')
  const isDefault = searchParams.get('isDefault')

  let query = supabase
    .from('recipients')
    .select('*')
    .order('sortOrder', { ascending: true })
    .order('createdAt', { ascending: false })

  if (isActive !== null) query = query.eq('isActive', isActive === 'true')
  if (isDefault !== null) query = query.eq('isDefault', isDefault === 'true')
  if (keyword) {
    query = query.or(
      `displayName.ilike.%${keyword}%,memo.ilike.%${keyword}%`,
    )
  }

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
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
    .eq('lineUserId', lineUserId)
    .maybeSingle()

  if (existing) {
    return Response.json(
      { error: 'この lineUserId は既に登録されています' },
      { status: 409 },
    )
  }

  // 新規は末尾に追加
  const { data: maxRow } = await supabase
    .from('recipients')
    .select('sortOrder')
    .order('sortOrder', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sortOrder ?? 0) + 1

  const { data, error } = await supabase
    .from('recipients')
    .insert({
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
