import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const { categories } = await request.json()

  const { data, error } = await supabase
    .from('persons')
    .update({ categories, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: '人物が見つかりません' }, { status: 404 })
  return Response.json(data)
}
