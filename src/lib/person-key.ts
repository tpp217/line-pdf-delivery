// 人物同定のための「正規化キー」と類似度判定。
//
// 背景:
//   PDF の取り込みは長らく「ファイル名（拡張子を除いた全文）＝人物名」で、
//   persons を (tenant_id, name) の完全一致で upsert していた。
//   クライアントのファイル名ルールは統一されていないため
//     奥村華月.pdf / 給与支払明細書_奥村華月.pdf / 給与明細 奥村華月 202604.pdf
//   がすべて「別人」として登録され、カテゴリ未設定のまま量産される。
//   カテゴリは配信の絞り込み（PDF管理画面）と送信先解決（category_recipients）の
//   両方を兼ねているため、これは「一括送信から黙って漏れる」という事故になる。
//
// 方針（誤配信を出さないことを最優先）:
//   - 正規化して「文字列として完全一致」するものだけ自動で同一人物に寄せる。
//   - 「奥村」と「奥村華月」（姓のみ↔フルネーム）、「奥村」と「奥山」（1文字違い）は
//     同一人物か別人か機械には判別できない。ここは絶対に自動統合せず、
//     画面に候補として出して人が確定する（確定結果は person_aliases に学習させる）。
//
// 設計メモ（なぜ name_key を DB に持たないか）:
//   書類名トークンの辞書はテナントごとに画面から増やせる（person_key_tokens）。
//   キーを列として永続化すると、辞書に 1 語足すたびに全行の再計算が要る。
//   persons はテナントあたり数百件規模なので、必要なときに全件読んで
//   その場で計算する方が常に整合し、辞書変更が即座に効く。

/**
 * 既定の書類名トークン（どのクライアントでも出がちなもの）。
 * テナント固有の語は person_key_tokens に追加され、こちらと合成して使う。
 */
export const DEFAULT_DOC_TOKENS: string[] = [
  '給与支払明細書',
  '給与明細書',
  '給与明細',
  '給料明細書',
  '給料明細',
  '賞与支払明細書',
  '賞与明細書',
  '賞与明細',
  '支払明細書',
  '支払通知書',
  '支払調書',
  '源泉徴収票',
  '控除証明書',
  '明細書',
  '通知書',
  '請求書',
  '領収書',
  // 単体でも書類種別としてしか現れない語（氏名には出ない）。
  // 「【給与】奥村華月.pdf」のような書き方を拾うために入れている。
  '源泉徴収',
  '給与',
  '給料',
  '賞与',
  '明細',
  '支払',
]

/**
 * ファイル名／人物名を比較用のキーへ正規化する。
 *
 * 手順:
 *   1. 拡張子（.pdf）を落とす
 *   2. NFKC 正規化（全角英数→半角・半角カナ→全角カナ）＋小文字化
 *   3. 書類名トークンを長い順に除去（「給与明細書」が「明細書」に食われないように）
 *   4. 元号・日付・連番など数字まわりを除去
 *   5. 区切り記号・空白・括弧を除去
 *   6. 末尾の敬称（様・殿・さん・氏）を除去
 *
 * 注意: 長音符「ー」は除去しない（カタカナ氏名の正当な構成文字のため）。
 *       「年月日」も単体では除去しない（例:「華月」の月を壊さないため）。
 *       数字に隣接するときだけ日付として落とす。
 */
export function normalizePersonKey(raw: string, tokens: readonly string[] = []): string {
  if (!raw) return ''

  let s = raw.replace(/\.pdf$/i, '')
  s = s.normalize('NFKC').toLowerCase()

  // 3) 書類名トークン除去（長い順＝最長一致優先）
  const dict = [...tokens, ...DEFAULT_DOC_TOKENS]
    .map((t) => t.normalize('NFKC').toLowerCase().trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length)
  for (const t of dict) s = s.split(t).join('')

  // 4) 元号・日付・連番。必ず「数字を伴う形」から先に落とす。
  s = s.replace(/(令和|平成|昭和)\s*\d*\s*年?/g, '')
  s = s.replace(/\d+\s*[年月日]/g, '')
  s = s.replace(/[（(［[【]\s*\d+\s*[）)］\]】]/g, '')
  s = s.replace(/\d+/g, '')

  // 5) 区切り・空白・装飾記号・括弧。
  //    括弧は日付を抜いた後に空で残る（例:「(2026年04月)」→「()」）ので最後にまとめて落とす。
  s = s.replace(/[\s_\-‐‑‒–—―・,，.。、~〜|｜@#*+/\\]/g, '')
  s = s.replace(/[()[\]{}【】〔〕〈〉《》「」『』]/g, '')

  // 6) 末尾の敬称。「奥村華月様.pdf」と「奥村華月.pdf」を同一視する。
  s = s.replace(/(様|殿|さん|氏)$/, '')

  return s.trim()
}

/** 2-gram 集合。1文字以下はその文字自体を 1 要素として扱う。 */
function bigrams(s: string): string[] {
  if (s.length < 2) return s.length === 1 ? [s] : []
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

/** bigram の Dice 係数（0〜1）。表記の入れ替え・余分な語に強い。 */
function diceCoefficient(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.length === 0 || B.length === 0) return 0
  const counts = new Map<string, number>()
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1)
  let hit = 0
  for (const g of B) {
    const c = counts.get(g) ?? 0
    if (c > 0) {
      hit++
      counts.set(g, c - 1)
    }
  }
  return (2 * hit) / (A.length + B.length)
}

/** レーベンシュタイン距離。氏名は短いので DP そのままで十分速い。 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * 正規化キー同士の類似度（0〜1）。
 *
 * 日本語の氏名は 2〜5 文字と短く、bigram だけだと 1 文字違い
 * （奥村華月 / 奥山華月 → 0.33）を拾えない。編集距離ベースの比率
 * （同ケースで 0.75）と併用し、大きい方を採る。
 */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const editRatio = 1 - levenshtein(a, b) / Math.max(a.length, b.length)
  return Math.max(diceCoefficient(a, b), editRatio)
}

/** 候補として提示する最低スコア。これ未満は無関係とみなして出さない。 */
export const CANDIDATE_THRESHOLD = 0.6

/** 前方一致を候補とみなす最低キー長。1文字キーは何にでも当たるので除外する。 */
export const PREFIX_MIN_LENGTH = 2

export type MatchReason = 'exact' | 'prefix' | 'fuzzy'

/**
 * 2 つの正規化キーの関係を判定する。null なら候補にしない。
 *
 * - exact : 正規化後に完全一致。自動で同一人物にしてよい唯一のケース。
 * - prefix: 一方が他方の先頭（姓のみ↔フルネーム）。同姓が複数いると誤るので人が確認。
 * - fuzzy : 編集距離・bigram が近い（誤字の疑い）。同じく人が確認。
 */
export function classifyMatch(
  a: string,
  b: string,
): { reason: MatchReason; score: number } | null {
  if (!a || !b) return null
  if (a === b) return { reason: 'exact', score: 1 }

  const score = similarity(a, b)

  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= PREFIX_MIN_LENGTH && long.startsWith(short)) {
    return { reason: 'prefix', score: Math.max(score, CANDIDATE_THRESHOLD) }
  }

  if (score >= CANDIDATE_THRESHOLD) return { reason: 'fuzzy', score }
  return null
}

export type PersonLike = {
  id: string
  name: string
  categories?: string[] | null
  createdAt?: string | null
}

/**
 * 正規化キーが同じ人物行が複数あるときに、どれへ紐付けるかを決める。
 *
 * 既存データには「同じ人だがカテゴリが付いている行と付いていない行」が並存する
 * （書類名プレフィックス違いで別人として量産されたため）。カテゴリ有りを優先すれば、
 * 既存行を統合しなくても新規アップロードは正しい側へ吸い寄せられる。
 * 同条件なら古い行（＝先に作られた正）を選ぶ。
 */
export function pickBestPerson<T extends PersonLike>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) => {
    const aCat = (a.categories?.length ?? 0) > 0 ? 1 : 0
    const bCat = (b.categories?.length ?? 0) > 0 ? 1 : 0
    if (aCat !== bCat) return bCat - aCat
    const aAt = a.createdAt ?? ''
    const bAt = b.createdAt ?? ''
    if (aAt !== bAt) return aAt < bAt ? -1 : 1
    return a.id < b.id ? -1 : 1
  })[0]
}
