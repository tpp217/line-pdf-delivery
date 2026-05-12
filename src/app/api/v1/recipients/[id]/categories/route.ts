import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

/**
 * 送信先に紐付くカテゴリの取得
 */
export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('category_recipients')
    .select('category_name')
    .eq('recipientId', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const categories = (data ?? []).map((r) => (r as { category_name: string }).category_name)
  return Response.json({ categories })
}

/**
 * 送信先に紐付くカテゴリを置き換える
 * Body: { categories: string[] }
 */
export async function PUT(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const body = await request.json().catch(() => null)
  const categories: string[] = Array.isArray(body?.categories)
    ? body.categories
        .filter((c: unknown) => typeof c === 'string')
        .map((c: string) => c.trim())
        .filter(Boolean)
    : null

  if (categories === null) {
    return Response.json({ error: 'categories (string[]) は必須です' }, { status: 400 })
  }

  const { error: delErr } = await supabase
    .from('category_recipients')
    .delete()
    .eq('recipientId', id)
  if (delErr) {
    return Response.json({ error: `削除失敗: ${delErr.message}` }, { status: 500 })
  }

  if (categories.length > 0) {
    const rows = categories.map((c) => ({ category_name: c, recipientId: id }))
    const { error: insErr } = await supabase.from('category_recipients').insert(rows)
    if (insErr) {
      return Response.json({ error: `登録失敗: ${insErr.message}` }, { status: 500 })
    }
  }

  return Response.json({ categories })
}
