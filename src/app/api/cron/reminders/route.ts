import { supabase } from '@/lib/supabase'
import { pushMessage } from '@/lib/line'
import { getNextRun } from '@/lib/cron'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const { data: reminders } = await supabase
    .from('reminders')
    .select('*, recipient:recipients(id, displayName, lineUserId)')
    .eq('isActive', true)
    .lte('nextRunAt', now)

  if (!reminders || reminders.length === 0) {
    return Response.json({ message: '実行対象なし', executed: 0 })
  }

  let executed = 0

  for (const reminder of reminders) {
    const lineUserId = reminder.recipient?.lineUserId
    if (!lineUserId) continue

    const result = await pushMessage(lineUserId, [
      { type: 'text', text: reminder.message },
    ])

    const nextRunAt = getNextRun(reminder.cronExpression)

    await supabase
      .from('reminders')
      .update({
        lastRunAt: now,
        nextRunAt: nextRunAt.toISOString(),
      })
      .eq('id', reminder.id)

    if (result.ok) executed++
  }

  return Response.json({ message: `${executed}件送信`, executed })
}
