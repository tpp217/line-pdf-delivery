// persons の解決（取り込み時）と候補算出（画面の「要確認」）の共通処理。
//
// 正規化キーは列として持たず、その都度 persons を全件読んで計算する
// （理由は supabase/migrations/2026-09-13_person_matching.sql の設計メモ参照）。
// テナントあたり数百件規模を前提にした実装で、それを超える規模になったら
// name_key の永続化＋辞書変更時の再計算に切り替えること。

import { supabase } from '@/lib/supabase'
import {
  classifyMatch,
  normalizePersonKey,
  pickBestPerson,
  type MatchReason,
  type PersonLike,
} from '@/lib/person-key'

/** persons を全件読むときの安全弁。これを超えたら設計を見直す合図。 */
const PERSON_SCAN_LIMIT = 5000

export type PersonRow = {
  id: string
  name: string
  categories: string[] | null
  createdAt: string | null
}

/** 1 リクエスト分のマッチング用インデックス。 */
export type MatchIndex = {
  tenantId: string
  tokens: string[]
  persons: PersonRow[]
  /** 正規化キー → その キーを持つ人物行（既存データには重複がある） */
  byKey: Map<string, PersonRow[]>
  /** 確定済みエイリアス: 正規化キー → person_id */
  aliases: Map<string, string>
  /** 「別人」と確定済みのペア（"idA|idB" の昇順キー） */
  dismissed: Set<string>
}

export function dismissalKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** テナントの書類名トークン辞書を読む。 */
export async function loadTokens(tenantId: string): Promise<string[]> {
  const { data } = await supabase
    .from('person_key_tokens')
    .select('token')
    .eq('tenant_id', tenantId)
  return (data ?? []).map((r) => (r as { token: string }).token)
}

/** マッチングに必要な 3 つの表をまとめて読み、インデックスを組む。 */
export async function loadMatchIndex(tenantId: string): Promise<MatchIndex> {
  const [tokens, personsRes, aliasRes, dismissRes] = await Promise.all([
    loadTokens(tenantId),
    supabase
      .from('persons')
      .select('id, name, categories, createdAt')
      .eq('tenant_id', tenantId)
      .limit(PERSON_SCAN_LIMIT),
    supabase
      .from('person_aliases')
      .select('alias_key, person_id')
      .eq('tenant_id', tenantId),
    supabase
      .from('person_match_dismissals')
      .select('person_id_a, person_id_b')
      .eq('tenant_id', tenantId),
  ])

  // 読み込みに失敗しても取り込み自体は止めない（PDF が登録できなくなる方が損害が大きい）。
  // ただし黙って劣化させない: エイリアスが読めないと「同一人物と確定済み」の学習が
  // 効かず、統合したはずの人物の重複が再び作られる。必ずログに残す。
  for (const [label, res] of [
    ['persons', personsRes],
    ['person_aliases', aliasRes],
    ['person_match_dismissals', dismissRes],
  ] as const) {
    if (res.error) {
      console.error(`[person-match] ${label} の読み込みに失敗:`, res.error.message)
    }
  }

  const persons = (personsRes.data ?? []) as PersonRow[]

  const byKey = new Map<string, PersonRow[]>()
  for (const p of persons) {
    const key = normalizePersonKey(p.name, tokens)
    if (!key) continue
    const arr = byKey.get(key)
    if (arr) arr.push(p)
    else byKey.set(key, [p])
  }

  const aliases = new Map<string, string>()
  for (const row of (aliasRes.data ?? []) as { alias_key: string; person_id: string }[]) {
    aliases.set(row.alias_key, row.person_id)
  }

  const dismissed = new Set<string>()
  for (const row of (dismissRes.data ?? []) as {
    person_id_a: string
    person_id_b: string
  }[]) {
    dismissed.add(dismissalKey(row.person_id_a, row.person_id_b))
  }

  return { tenantId, tokens, persons, byKey, aliases, dismissed }
}

export type ResolveOutcome = 'alias' | 'key' | 'created'

export type ResolveResult = {
  personId: string | null
  personName: string
  key: string
  outcome: ResolveOutcome
}

/**
 * ファイル名から人物を解決する。解決順は次のとおりで、ここでは絶対に
 * あいまい一致で既存人物へ寄せない（誤って他人の給与明細を配信しないため）。
 *
 *   1. person_aliases に一致        … 人が「同一人物」と確定済み
 *   2. 正規化キーが完全一致          … カテゴリ設定済みの行を優先（pickBestPerson）
 *   3. どちらも無ければ新規人物を作る … 似た人物は画面の「要確認」に出る
 *
 * 新規作成した行は index に足すので、同じバッチ内の後続ファイルは 2 で拾える。
 */
export async function resolvePersonForFile(
  index: MatchIndex,
  fileName: string,
): Promise<ResolveResult> {
  const personName = fileName.replace(/\.pdf$/i, '')
  const key = normalizePersonKey(fileName, index.tokens)

  // 1) 学習済みエイリアス
  const aliasId = key ? index.aliases.get(key) : undefined
  if (aliasId) return { personId: aliasId, personName, key, outcome: 'alias' }

  // 2) 正規化キーの完全一致（カテゴリ有りを優先）
  const sameKey = key ? index.byKey.get(key) : undefined
  if (sameKey && sameKey.length > 0) {
    const best = pickBestPerson(sameKey)
    if (best) return { personId: best.id, personName, key, outcome: 'key' }
  }

  // 3) 新規作成。
  //    persons は (tenant_id, name) が UNIQUE なので、正規化キーが空になる
  //    ような名前でも upsert が既存行を拾って重複を作らない。
  const { data: created, error } = await supabase
    .from('persons')
    .upsert(
      { tenant_id: index.tenantId, name: personName },
      { onConflict: 'tenant_id,name' },
    )
    .select('id, name, categories, createdAt')
    .single()

  if (error || !created) {
    console.error(`[person-match] persons upsert failed (${personName}):`, error?.message)
    return { personId: null, personName, key, outcome: 'created' }
  }

  const row = created as PersonRow
  index.persons.push(row)
  if (key) {
    const arr = index.byKey.get(key)
    if (arr) arr.push(row)
    else index.byKey.set(key, [row])
  }

  return { personId: row.id, personName, key, outcome: 'created' }
}

export type Candidate = {
  person: { id: string; name: string; categories: string[] }
  reason: MatchReason
  score: number
}

export type CandidateGroup = {
  person: { id: string; name: string; categories: string[] }
  candidates: Candidate[]
}

function toView(p: PersonRow): { id: string; name: string; categories: string[] } {
  return { id: p.id, name: p.name, categories: p.categories ?? [] }
}

/**
 * 「要確認」リストを組み立てる。
 *
 * 起点はカテゴリ未設定の人物（＝カテゴリ絞り込みから漏れて一括送信に乗らない行）。
 * その人物に対して、同一テナントの他の人物のうち正規化キーが一致／前方一致／
 * 類似するものを候補として返す。却下済みペアと自分自身は除く。
 *
 * カテゴリ設定済みの候補を先に見せる（統合先として妥当なのは通常そちら）。
 */
export function buildCandidateGroups(index: MatchIndex): CandidateGroup[] {
  const keyOf = new Map<string, string>()
  for (const p of index.persons) keyOf.set(p.id, normalizePersonKey(p.name, index.tokens))

  const groups: CandidateGroup[] = []

  for (const person of index.persons) {
    if ((person.categories?.length ?? 0) > 0) continue
    const key = keyOf.get(person.id) ?? ''
    if (!key) continue

    const candidates: Candidate[] = []
    for (const other of index.persons) {
      if (other.id === person.id) continue
      if (index.dismissed.has(dismissalKey(person.id, other.id))) continue
      const otherKey = keyOf.get(other.id) ?? ''
      if (!otherKey) continue
      const m = classifyMatch(key, otherKey)
      if (!m) continue
      candidates.push({ person: toView(other), reason: m.reason, score: m.score })
    }

    if (candidates.length === 0) continue

    candidates.sort((a, b) => {
      const aCat = a.person.categories.length > 0 ? 1 : 0
      const bCat = b.person.categories.length > 0 ? 1 : 0
      if (aCat !== bCat) return bCat - aCat
      if (a.score !== b.score) return b.score - a.score
      return a.person.name.localeCompare(b.person.name, 'ja')
    })

    groups.push({ person: toView(person), candidates })
  }

  // 確度の高い（＝完全一致の候補を持つ）ものから片付けられるように並べる。
  groups.sort((a, b) => {
    const aTop = a.candidates[0]
    const bTop = b.candidates[0]
    if (aTop.reason !== bTop.reason) {
      const rank: Record<MatchReason, number> = { exact: 0, prefix: 1, fuzzy: 2 }
      return rank[aTop.reason] - rank[bTop.reason]
    }
    if (aTop.score !== bTop.score) return bTop.score - aTop.score
    return a.person.name.localeCompare(b.person.name, 'ja')
  })

  return groups
}

export type { PersonLike }
