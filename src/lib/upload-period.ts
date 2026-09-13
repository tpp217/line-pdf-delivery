// 「〇月アップ分」タグ（upload_period）の共通処理。
//
// 画面の年／月タブはこのタグで分類する。実際のアップロード日時（uploadedAt）は
// タグの既定値を出すためだけに使い、分類には使わない。過去分の差し替えを
// 後からアップロードすることがあるため、実日付に引きずられると
// 「7月タブを選んで送ったら 6月分だった」という事故になる。
//
// 形式は 'YYYY-MM'。DB 側にも同じ形式の CHECK 制約を張ってある
// （supabase/migrations/2026-09-14_upload_period.sql）。

/** タグの表記。運用上の基準は日本時間。 */
const PERIOD_TIME_ZONE = 'Asia/Tokyo'

export const UPLOAD_PERIOD_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/

export function isValidUploadPeriod(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_PERIOD_PATTERN.test(value)
}

/**
 * 日時から 'YYYY-MM' を作る（JST 基準）。
 * sv-SE ロケールは 'YYYY-MM-DD' を返すので、そのまま先頭 7 文字を使える。
 */
export function toUploadPeriod(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: PERIOD_TIME_ZONE }).slice(0, 7)
}

/** 'YYYY-MM' を「2026年9月」に整形する。 */
export function formatUploadPeriod(period: string): string {
  if (!isValidUploadPeriod(period)) return period
  const [y, m] = period.split('-')
  return `${y}年${Number(m)}月`
}

/** 'YYYY-MM' を n か月ずらす。 */
export function shiftUploadPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * 選択肢に出す期間の一覧。
 * 既定（＝今月）を中心に、過去分の差し替えを選べるよう遡り分を多めに出す。
 * 既にデータ上に存在する期間（extra）は、範囲外でも必ず含める。
 */
export function uploadPeriodOptions(
  current: string = toUploadPeriod(),
  extra: readonly string[] = [],
  { back = 24, forward = 1 }: { back?: number; forward?: number } = {},
): string[] {
  const set = new Set<string>()
  for (let i = -back; i <= forward; i++) set.add(shiftUploadPeriod(current, i))
  for (const e of extra) if (isValidUploadPeriod(e)) set.add(e)
  return Array.from(set).sort().reverse()
}
