import { supabase } from '@/lib/supabase'
import { getNextRun } from '@/lib/cron'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { data, error } = await supabase
    .from('reminders')
    .select('*, recipient:recipients(id, displayName)')
    .eq('tenant_id', tenantId)
    .order('createdAt', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const body = await request.json()
  const { title, message, recipientId, cronExpression } = body

  if (!title || !message || !recipientId || !cronExpression) {
    return Response.json({ error: 'title, message, recipientId, cronExpression は必須です' }, { status: 400 })
  }

  // 紐付け先 recipient が同一テナントに属することを確認（クロステナント紐付け防止）。
  const { data: recipient } = await supabase
    .from('recipients')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', recipientId)
    .maybeSingle()
  if (!recipient) {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }

  const nextRunAt = getNextRun(cronExpression)

  const { data, error } = await supabase
    .from('reminders')
    .insert({
      tenant_id: tenantId,
      title,
      message,
      recipientId,
      cronExpression,
      nextRunAt: nextRunAt.toISOString(),
      isActive: true,
    })
    .select('*, recipient:recipients(id, displayName)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
