import { supabase } from '@/lib/supabase'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

/**
 * カテゴリ↔送信先の紐付け一覧
 *
 * Returns:
 *   { items: [{ category: string, recipientIds: string[] }] }
 */
export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { data, error } = await supabase
    .from('category_recipients')
    .select('category_name, recipientId')
    .eq('tenant_id', tenantId)

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
