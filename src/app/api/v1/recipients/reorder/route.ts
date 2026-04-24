import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

/**
 * 送信先の並び替え。
 * Body: { ids: string[] }  - 新しい順に並んだ recipient id の配列
 * sortOrder を 1..n に振り直す。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown) => typeof v === 'string')
    : []

  if (ids.length === 0) {
    return Response.json({ error: 'ids は必須です' }, { status: 400 })
  }

  const updates = ids.map((id, index) =>
    supabase
      .from('recipients')
      .update({ sortOrder: index + 1 })
      .eq('id', id),
  )

  const results = await Promise.all(updates)
  const firstError = results.find((r) => r.error)
  if (firstError?.error) {
    return Response.json({ error: firstError.error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
