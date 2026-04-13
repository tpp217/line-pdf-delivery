import { supabase } from '@/lib/supabase'
import { getNextRun } from '@/lib/cron'
import { NextRequest } from 'next/server'

export async function GET() {
  const { data, error } = await supabase
    .from('reminders')
    .select('*, recipient:recipients(id, displayName)')
    .order('createdAt', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { title, message, recipientId, cronExpression } = body

  if (!title || !message || !recipientId || !cronExpression) {
    return Response.json({ error: 'title, message, recipientId, cronExpression は必須です' }, { status: 400 })
  }

  const nextRunAt = getNextRun(cronExpression)

  const { data, error } = await supabase
    .from('reminders')
    .insert({
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
