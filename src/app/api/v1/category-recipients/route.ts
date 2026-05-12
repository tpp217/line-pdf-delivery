import { supabase } from '@/lib/supabase'

/**
 * カテゴリ↔送信先の紐付け一覧
 *
 * Returns:
 *   { items: [{ category: string, recipientIds: string[] }] }
 */
export async function GET() {
  const { data, error } = await supabase
    .from('category_recipients')
    .select('category_name, recipientId')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const map = new Map<string, string[]>()
  for (const row of (data ?? []) as { category_name: string; recipientId: string }[]) {
    const arr = map.get(row.category_name) ?? []
    arr.push(row.recipientId)
    map.set(row.category_name, arr)
  }

  const items = Array.from(map.entries()).map(([category, recipientIds]) => ({
    category,
    recipientIds,
  }))

  return Response.json({ items })
}
