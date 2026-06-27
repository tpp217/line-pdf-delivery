import { supabase } from '@/lib/supabase'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(req)
  if (!tenantId) return unauthenticatedTenant()

  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('recipients')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(request: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { id } = await ctx.params
  const body = await request.json()

  if (body._delete) {
    // 依存レコードを子→親の順でカスケード削除（すべて呼び出し元 tenant に閉じる）
    // 1) 送信ジョブのIDを取得 → 2) 配信イベントを削除 → 3) 送信ジョブ削除
    //    → 4) リマインダー・ルーティングルール削除 → 5) 送信先本体を削除
    const { data: sendJobs, error: sjFetchErr } = await supabase
      .from('send_jobs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('recipientId', id)
    if (sjFetchErr) return Response.json({ error: `送信履歴取得失敗: ${sjFetchErr.message}` }, { status: 500 })

    const sendJobIds = (sendJobs ?? []).map((j) => j.id)
    if (sendJobIds.length > 0) {
      const { error: evErr } = await supabase
        .from('delivery_events')
        .delete()
        .eq('tenant_id', tenantId)
        .in('sendJobId', sendJobIds)
      if (evErr) return Response.json({ error: `配信イベント削除失敗: ${evErr.message}` }, { status: 500 })

      const { error: sjErr } = await supabase.from('send_jobs').delete().eq('tenant_id', tenantId).eq('recipientId', id)
      if (sjErr) return Response.json({ error: `送信ジョブ削除失敗: ${sjErr.message}` }, { status: 500 })
    }

    const { error: remErr } = await supabase.from('reminders').delete().eq('tenant_id', tenantId).eq('recipientId', id)
    if (remErr) return Response.json({ error: `リマインダー削除失敗: ${remErr.message}` }, { status: 500 })

    const { error: ruleErr } = await supabase.from('routing_rules').delete().eq('tenant_id', tenantId).eq('recipientId', id)
    if (ruleErr) return Response.json({ error: `ルーティングルール削除失敗: ${ruleErr.message}` }, { status: 500 })

    const { error } = await supabase.from('recipients').delete().eq('tenant_id', tenantId).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return new Response(null, { status: 204 })
  }

  const { displayName, memo, isActive, isDefault } = body
  const updates: Record<string, unknown> = {}
  if (displayName !== undefined) updates.displayName = displayName
  if (memo !== undefined) updates.memo = memo
  if (isActive !== undefined) updates.isActive = isActive
  if (isDefault !== undefined) updates.isDefault = isDefault

  // 更新項目が無いリクエストは無意味な書き込みになるため早期に弾く
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: '更新項目がありません' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('recipients')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  return Response.json(data)
}

export async function DELETE(req: NextRequest, ctx: Context) {
  const tenantId = await resolveTenantId(req)
  if (!tenantId) return unauthenticatedTenant()

  const { id } = await ctx.params
  const { error } = await supabase
    .from('recipients')
    .update({ isActive: false })
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
