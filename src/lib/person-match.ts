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

export type CandidatePerson = {
  id: string
  name: string
  categories: string[]
  /** 正規化キー。統合先の既定を決めるのに使う。 */
  key: string
}

export type ClusterMember = CandidatePerson & {
  /** クラスタの代表キー（最も多くの人物が共有するキー）との関係。 */
  reason: MatchReason
  score: number
}

export type CandidateCluster = {
  /** React の key 用。構成が同じなら安定する値。 */
  id: string
  members: ClusterMember[]
}

function toView(p: PersonRow, key: string): CandidatePerson {
  return { id: p.id, name: p.name, categories: p.categories ?? [], key }
}

/**
 * 「要確認」リストを組み立てる。
 *
 * ★ 人物ごとではなく「クラスタごと」に 1 件返す。
 *
 *   以前は未分類の人物 1 行につき 1 グループを作っていた。そのため同じ塊に未分類の
 *   行が複数あると、同じ顔ぶれが行数ぶん並んだ（「新名鉄平が何度も出てくる」）。
 *   ファイル名の表記ゆれは 1 人につき複数行を生むので、これは例外ではなく常態だった。
 *   一致関係で連結成分を取り、塊ごとに 1 件だけ出す。
 *
 * 返すのは「未分類の人物を含む」クラスタだけ。全員にカテゴリが付いているなら
 * 配信から漏れておらず、急いで直す理由がないため（重複は残るが実害が出ていない）。
 *
 * 規模の前提: person-match の他の処理と同じくテナントあたり数百件を想定。
 * 総当たりだが、キーの組み合わせで判定結果をキャッシュするので実質はキー数の二乗。
 */
export function buildCandidateClusters(index: MatchIndex): CandidateCluster[] {
  const keyOf = new Map<string, string>()
  const persons: PersonRow[] = []
  for (const p of index.persons) {
    const key = normalizePersonKey(p.name, index.tokens)
    if (!key) continue // キーが空になる名前は比較のしようがないので対象外
    keyOf.set(p.id, key)
    persons.push(p)
  }

  // ── union-find で一致関係の連結成分を作る ──
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) as string
    // 経路圧縮
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const p of persons) parent.set(p.id, p.id)

  // キーの組み合わせごとの判定はキャッシュする（同じキーの人物が複数いるため）。
  // 区切りの "|" は正規化で必ず取り除かれるので、キーに現れず衝突しない。
  const verdict = new Map<string, { reason: MatchReason; score: number } | null>()
  const classify = (a: string, b: string) => {
    const ck = a < b ? a + '|' + b : b + '|' + a
    let v = verdict.get(ck)
    if (v === undefined) {
      v = classifyMatch(a, b)
      verdict.set(ck, v)
    }
    return v
  }

  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const a = persons[i]
      const b = persons[j]
      // 「別人」と確定済みのペアは辺を張らない（塊が再結合しないように）。
      if (index.dismissed.has(dismissalKey(a.id, b.id))) continue
      if (!classify(keyOf.get(a.id) as string, keyOf.get(b.id) as string)) continue
      union(a.id, b.id)
    }
  }

  // ── 連結成分ごとにまとめる ──
  const byRoot = new Map<string, PersonRow[]>()
  for (const p of persons) {
    const root = find(p.id)
    const arr = byRoot.get(root)
    if (arr) arr.push(p)
    else byRoot.set(root, [p])
  }

  const clusters: CandidateCluster[] = []

  for (const rows of byRoot.values()) {
    if (rows.length < 2) continue
    // カテゴリ未設定の人物を含まない塊は配信から漏れていないので出さない。
    if (!rows.some((r) => (r.categories?.length ?? 0) === 0)) continue

    // 代表キー: 最も多くの人物が共有するキー。同数なら長いほう（より完全な氏名）。
    const keyCount = new Map<string, number>()
    for (const r of rows) {
      const k = keyOf.get(r.id) as string
      keyCount.set(k, (keyCount.get(k) ?? 0) + 1)
    }
    let mainKey = ''
    let best = -1
    for (const [k, c] of keyCount) {
      if (c > best || (c === best && k.length > mainKey.length)) {
        mainKey = k
        best = c
      }
    }

    const members: ClusterMember[] = rows.map((r) => {
      const key = keyOf.get(r.id) as string
      const v =
        key === mainKey ? { reason: 'exact' as MatchReason, score: 1 } : classify(mainKey, key)
      return {
        ...toView(r, key),
        // 連結成分は間接的に繋がることもあるので、代表と直接一致しない場合がある。
        reason: v?.reason ?? 'fuzzy',
        score: v?.score ?? 0,
      }
    })

    // 完全一致（＝確実に同じ表記）を先頭へ。その中はカテゴリ有り、名前順。
    members.sort((a, b) => {
      const rank: Record<MatchReason, number> = { exact: 0, prefix: 1, fuzzy: 2 }
      if (a.reason !== b.reason) return rank[a.reason] - rank[b.reason]
      const aCat = a.categories.length > 0 ? 1 : 0
      const bCat = b.categories.length > 0 ? 1 : 0
      if (aCat !== bCat) return bCat - aCat
      return a.name.localeCompare(b.name, 'ja')
    })

    clusters.push({ id: [...rows.map((r) => r.id)].sort()[0], members })
  }

  // 確度の高い（＝完全一致だけで構成された）塊から片付けられるように並べる。
  clusters.sort((a, b) => {
    const aAllExact = a.members.every((m) => m.reason === 'exact') ? 0 : 1
    const bAllExact = b.members.every((m) => m.reason === 'exact') ? 0 : 1
    if (aAllExact !== bAllExact) return aAllExact - bAllExact
    if (a.members.length !== b.members.length) return b.members.length - a.members.length
    return a.members[0].name.localeCompare(b.members[0].name, 'ja')
  })

  return clusters
}

export type { PersonLike }
