// 人物の統合（同一人物と確定）と却下（別人と確定）。
//
// 画面の「要確認」から 1 件ずつでも、まとめてでも呼ばれる。
// まとめて処理するときは、先に統合されて消えた人物を後続の指示が指すことが
// ありうるので（例: Y→X を処理した後に X→Z が来る）、統合の転送表を持って
// 解決してから実行する。

import { supabase } from '@/lib/supabase'
import { normalizePersonKey } from '@/lib/person-key'
import { loadTokens } from '@/lib/person-match'

export type MatchAction = {
  action: 'merge' | 'separate'
  sourceId: string
  targetId: string
}

export type MatchActionResult = MatchAction & {
  status: 'merged' | 'separated' | 'skipped' | 'failed'
  /** skipped / failed の理由。画面に出して原因が分かるようにする。 */
  reason?: string
  movedPdfs?: number
  learnedAlias?: string | null
}

type PersonRow = { id: string; name: string; categories: string[] | null }

async function loadPair(
  tenantId: string,
  sourceId: string,
  targetId: string,
): Promise<{ source?: PersonRow; target?: PersonRow; error?: string }> {
  const { data, error } = await supabase
    .from('persons')
    .select('id, name, categories')
    .eq('tenant_id', tenantId)
    .in('id', [sourceId, targetId])
  if (error) return { error: error.message }
  const rows = (data ?? []) as PersonRow[]
  return { source: rows.find((p) => p.id === sourceId), target: rows.find((p) => p.id === targetId) }
}

/**
 * sourceId を targetId に統合する（source は削除される）。
 *
 * 手順の順番には意味がある。person_aliases は persons への FK が ON DELETE CASCADE
 * なので、source を消す前にエイリアスを target へ付け替えないと学習結果が消える。
 */
export async function mergePersons(
  tenantId: string,
  sourceId: string,
  targetId: string,
  tokens: readonly string[],
): Promise<{ ok: true; movedPdfs: number; learnedAlias: string | null; categories: string[] } | { ok: false; error: string; notFound?: boolean }> {
  const { source, target, error: loadErr } = await loadPair(tenantId, sourceId, targetId)
  if (loadErr) return { ok: false, error: loadErr }
  if (!source || !target) return { ok: false, error: '人物が見つかりません', notFound: true }

  // 1) PDF の紐付けを移す。personName（配信メッセージのタイトルに使う元ファイル名）は
  //    意図的に書き換えない。統合しても LINE に届く文面は変わらない。
  const { count: movedPdfs, error: pdfErr } = await supabase
    .from('pdf_documents')
    .update({ personId: targetId }, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('personId', sourceId)
  if (pdfErr) return { ok: false, error: pdfErr.message }

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
    if (error) return { ok: false, error: error.message }
  }

  // 3) source を指していたエイリアスを target へ付け替える（削除より必ず前）。
  const { error: aliasMoveErr } = await supabase
    .from('person_aliases')
    .update({ person_id: targetId })
    .eq('tenant_id', tenantId)
    .eq('person_id', sourceId)
  if (aliasMoveErr) return { ok: false, error: aliasMoveErr.message }

  // 4) source の名前の正規化キーを target のエイリアスとして学習させる。
  //    次に同じ書き方のファイルが来たら、候補を経ずに直接 target へ紐付く。
  const sourceKey = normalizePersonKey(source.name, tokens)
  const targetKey = normalizePersonKey(target.name, tokens)
  const learnedAlias = sourceKey && sourceKey !== targetKey ? sourceKey : null
  if (learnedAlias) {
    const { error } = await supabase
      .from('person_aliases')
      .upsert(
        { tenant_id: tenantId, alias_key: learnedAlias, person_id: targetId },
        { onConflict: 'tenant_id,alias_key' },
      )
    if (error) return { ok: false, error: error.message }
  }

  // 5) source を削除。残っていた却下ペアは FK の CASCADE で一緒に消える。
  const { error: delErr } = await supabase
    .from('persons')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', sourceId)
  if (delErr) return { ok: false, error: delErr.message }

  return {
    ok: true,
    movedPdfs: movedPdfs ?? 0,
    learnedAlias,
    categories: mergedCategories,
  }
}

/** 別人として確定する。以後この組は候補に出さない。 */
export async function separatePersons(
  tenantId: string,
  sourceId: string,
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: string; notFound?: boolean }> {
  const { source, target, error: loadErr } = await loadPair(tenantId, sourceId, targetId)
  if (loadErr) return { ok: false, error: loadErr }
  if (!source || !target) return { ok: false, error: '人物が見つかりません', notFound: true }

  // ペアは (a < b) の順で保存する（同じ組が 2 行にならないように）。
  const [a, b] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId]
  const { error } = await supabase
    .from('person_match_dismissals')
    .upsert(
      { tenant_id: tenantId, person_id_a: a, person_id_b: b },
      { onConflict: 'tenant_id,person_id_a,person_id_b', ignoreDuplicates: true },
    )
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * 指示をまとめて適用する。
 *
 * 統合すると source は消えるので、後続の指示がその id を指していることがある
 * （画面上は別グループでも、同じ人物が候補として出るため）。転送表で読み替えてから
 * 実行し、読み替えた結果 source と target が同じになった指示は「済み」として飛ばす。
 *
 * 1 件失敗しても残りは続ける。全部やり直させるより、成功したぶんを確定させて
 * 失敗した組だけを画面に残すほうが復旧しやすい。
 */
export async function applyMatchActions(
  tenantId: string,
  actions: readonly MatchAction[],
): Promise<MatchActionResult[]> {
  const tokens = await loadTokens(tenantId)
  const redirect = new Map<string, string>()

  const resolve = (id: string): string => {
    let cur = id
    const seen = new Set<string>()
    while (redirect.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = redirect.get(cur) as string
    }
    return cur
  }

  const results: MatchActionResult[] = []

  for (const a of actions) {
    const sourceId = resolve(a.sourceId)
    const targetId = resolve(a.targetId)

    if (sourceId === targetId) {
      results.push({ ...a, status: 'skipped', reason: '先の統合で同じ人物になりました' })
      continue
    }

    if (a.action === 'merge') {
      const r = await mergePersons(tenantId, sourceId, targetId, tokens)
      if (r.ok) {
        redirect.set(sourceId, targetId)
        results.push({
          ...a,
          status: 'merged',
          movedPdfs: r.movedPdfs,
          learnedAlias: r.learnedAlias,
        })
      } else {
        results.push({ ...a, status: 'failed', reason: r.error })
      }
      continue
    }

    const r = await separatePersons(tenantId, sourceId, targetId)
    results.push(
      r.ok ? { ...a, status: 'separated' } : { ...a, status: 'failed', reason: r.error },
    )
  }

  return results
}
