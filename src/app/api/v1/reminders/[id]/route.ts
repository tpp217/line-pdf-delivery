import { supabase } from '@/lib/supabase'
import { getNextRun } from '@/lib/cron'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const body = await request.json()
  const { title, message, recipientId, cronExpression, isActive } = body

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (title !== undefined) updates.title = title
  if (message !== undefined) updates.message = message
  if (recipientId !== undefined) updates.recipientId = recipientId
  if (isActive !== undefined) updates.isActive = isActive
  if (cronExpression !== undefined) {
    updates.cronExpression = cronExpression
    updates.nextRunAt = getNextRun(cronExpression).toISOString()
  }

  const { data, error } = await supabase
    .from('reminders')
    .update(updates)
    .eq('id', id)
    .select('*, recipient:recipients(id, displayName)')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'リマインダーが見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const { error } = await supabase.from('reminders').delete().eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
