import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const body = await request.json()
  const { matchType, companyKey, recipientId, priority, isActive } = body

  const updates: Record<string, unknown> = {}
  if (matchType !== undefined) updates.matchType = matchType
  if (companyKey !== undefined) updates.companyKey = companyKey
  if (recipientId !== undefined) updates.recipientId = recipientId
  if (priority !== undefined) updates.priority = priority
  if (isActive !== undefined) updates.isActive = isActive

  const { data, error } = await supabase
    .from('routing_rules')
    .update(updates)
    .eq('id', id)
    .select('*, recipient:recipients(*)')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'ルールが見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const { error } = await supabase
    .from('routing_rules')
    .delete()
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
