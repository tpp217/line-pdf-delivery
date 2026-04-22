import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('recipients')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const body = await request.json()

  if (body._delete) {
    // 送信履歴があるなら完全削除はできない（履歴保護のため）
    const { count: sendJobCount, error: sendJobErr } = await supabase
      .from('send_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('recipientId', id)
    if (sendJobErr) return Response.json({ error: sendJobErr.message }, { status: 500 })
    if ((sendJobCount ?? 0) > 0) {
      return Response.json(
        { error: `この送信先には送信履歴(${sendJobCount}件)が残っているため、完全削除はできません。「無効化」をご利用ください。` },
        { status: 409 }
      )
    }

    // 依存テーブル（リマインダー・ルーティングルール）を先に削除してから本体を削除
    const { error: remErr } = await supabase.from('reminders').delete().eq('recipientId', id)
    if (remErr) return Response.json({ error: `リマインダー削除失敗: ${remErr.message}` }, { status: 500 })

    const { error: ruleErr } = await supabase.from('routing_rules').delete().eq('recipientId', id)
    if (ruleErr) return Response.json({ error: `ルーティングルール削除失敗: ${ruleErr.message}` }, { status: 500 })

    const { error } = await supabase.from('recipients').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return new Response(null, { status: 204 })
  }

  const { displayName, memo, isActive, isDefault } = body
  const updates: Record<string, unknown> = {}
  if (displayName !== undefined) updates.displayName = displayName
  if (memo !== undefined) updates.memo = memo
  if (isActive !== undefined) updates.isActive = isActive
  if (isDefault !== undefined) updates.isDefault = isDefault

  const { data, error } = await supabase
    .from('recipients')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const { error } = await supabase
    .from('recipients')
    .update({ isActive: false })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
