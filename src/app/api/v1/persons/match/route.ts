import { supabase } from '@/lib/supabase'
import { normalizePersonKey } from '@/lib/person-key'
import {
  buildCandidateGroups,
  dismissalKey,
  loadMatchIndex,
  loadTokens,
} from '@/lib/person-match'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

/**
 * 人物の「要確認」候補と、その確定（統合 / 別人）。
 *
 * 取り込み側（uploads/folder）は正規化キーの完全一致でしか既存人物へ寄せない。
 * 「奥村」と「奥村華月」、「奥村華月」と「奥山華月」のように同一人物か別人か
 * 機械には決められないものは、ここで候補として出して人が確定する。
 * 確定結果は person_aliases（同一人物）／person_match_dismissals（別人）に残り、
 * 次回以降のアップロードへ自動で効く。
 */

/** GET: { items: [{ person, candidates: [{ person, reason, score }] }] } */
export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const index = await loadMatchIndex(tenantId)
  return Response.json({ items: buildCandidateGroups(index) })
}

type PersonRow = { id: string; name: string; categories: string[] | null }

/**
 * POST: { action: 'merge' | 'separate', sourceId, targetId }
 *
 *   merge    … sourceId を targetId に統合する（source は削除される）
 *   separate … 別人として確定し、以後この組を候補に出さない
 */
export async function POST(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const body = await request.json().catch(() => ({}))
  const action = body?.action
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : ''
  const targetId = typeof body?.targetId === 'string' ? body.targetId : ''

  if (action !== 'merge' && action !== 'separate') {
    return Response.json(
      { error: "action は 'merge' または 'separate' です" },
      { status: 400 },
    )
  }
  if (!sourceId || !targetId) {
    return Response.json({ error: 'sourceId と targetId は必須です' }, { status: 400 })
  }
  if (sourceId === targetId) {
    return Response.json({ error: '同じ人物は指定できません' }, { status: 400 })
  }

  // 双方が同一テナントに属することを確認（クロステナント操作の防止）。
  const { data: rows, error: loadErr } = await supabase
    .from('persons')
    .select('id, name, categories')
    .eq('tenant_id', tenantId)
    .in('id', [sourceId, targetId])

  if (loadErr) return Response.json({ error: loadErr.message }, { status: 500 })

  const persons = (rows ?? []) as PersonRow[]
  const source = persons.find((p) => p.id === sourceId)
  const target = persons.find((p) => p.id === targetId)
  if (!source || !target) {
    return Response.json({ error: '人物が見つかりません' }, { status: 404 })
  }

  if (action === 'separate') {
    // ペアは (a < b) の順で保存する（同じ組が 2 行にならないように）。
    const [a, b] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId]
    const { error } = await supabase
      .from('person_match_dismissals')
      .upsert(
        { tenant_id: tenantId, person_id_a: a, person_id_b: b },
        { onConflict: 'tenant_id,person_id_a,person_id_b', ignoreDuplicates: true },
      )
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true, pair: dismissalKey(sourceId, targetId) })
  }

  // ── merge ──────────────────────────────────────────────
  // 1) PDF の紐付けを移す。personName（配信メッセージのタイトルに使う元ファイル名）は
  //    意図的に書き換えない。統合しても LINE に届く文面は変わらない。
  const { count: movedPdfs, error: pdfErr } = await supabase
    .from('pdf_documents')
    .update({ personId: targetId }, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('personId', sourceId)

  if (pdfErr) return Response.json({ error: pdfErr.message }, { status: 500 })

  // 2) カテゴリを和集合で寄せる（統合でカテゴリが減らないように）。
  const mergedCategories = Array.from(
    new Set([...(target.categories ?? []), ...(source.categories ?? [])]),
  )
  if (mergedCategories.length !== (target.categories ?? []).length) {
    const { error } = await supabase
      .from('persons')
      .update({ categories: mergedCategories, updatedAt: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', targetId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // 3) source を指していたエイリアスを target へ付け替える。
  //    persons の削除は person_aliases を CASCADE するので、必ず削除より前に行う。
  const { error: aliasMoveErr } = await supabase
    .from('person_aliases')
    .update({ person_id: targetId })
    .eq('tenant_id', tenantId)
    .eq('person_id', sourceId)
  if (aliasMoveErr) return Response.json({ error: aliasMoveErr.message }, { status: 500 })

  // 4) source の名前の正規化キーを target のエイリアスとして学習させる。
  //    次に同じ書き方のファイルが来たら、候補を経ずに直接 target へ紐付く。
  const tokens = await loadTokens(tenantId)
  const sourceKey = normalizePersonKey(source.name, tokens)
  const targetKey = normalizePersonKey(target.name, tokens)
  if (sourceKey && sourceKey !== targetKey) {
    const { error } = await supabase
      .from('person_aliases')
      .upsert(
        { tenant_id: tenantId, alias_key: sourceKey, person_id: targetId },
        { onConflict: 'tenant_id,alias_key' },
      )
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // 5) source を削除。残っていた却下ペアは FK の CASCADE で一緒に消える。
  const { error: delErr } = await supabase
    .from('persons')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', sourceId)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })

  return Response.json({
    ok: true,
    mergedInto: { id: target.id, name: target.name, categories: mergedCategories },
    movedPdfs: movedPdfs ?? 0,
    learnedAlias: sourceKey && sourceKey !== targetKey ? sourceKey : null,
  })
}
