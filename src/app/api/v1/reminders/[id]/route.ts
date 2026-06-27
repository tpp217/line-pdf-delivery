import { supabase } from '@/lib/supabase'
import { getNextRun } from '@/lib/cron'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

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

  // recipientId を差し替える場合、新しい紐付け先も同一テナントであることを確認。
  if (recipientId !== undefined) {
    const { data: recipient } = await supabase
      .from('recipients')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', recipientId)
      .maybeSingle()
    if (!recipient) {
      return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
    }
  }

  const { data, error } = await supabase
    .from('reminders')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('*, recipient:recipients(id, displayName)')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'リマインダーが見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(req)
  if (!tenantId) return unauthenticatedTenant()

  const { id } = await ctx.params
  const { error } = await supabase.from('reminders').delete().eq('tenant_id', tenantId).eq('id', id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
