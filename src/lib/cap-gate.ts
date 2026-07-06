// capability ゲート（CAP_ENFORCE 対応・既定は監視モード）
//
// workspace-hub 発行 JWT の capabilities（string 配列 claim）で「操作単位」の権限を
// 判定する二段目のゲート。一段目の auth-gate（AUTH_ENFORCE / systems[] ＝ この
// システムに入れるか）とは独立しており、AUTH_ENFORCE の挙動には一切影響しない。
//
// 判定ルール（requiredCapability）:
//   1. LINE 送信・配信の実行系エンドポイント（下記 SEND_PATHS） → "lpd.send"
//   2. その他の書き込み系リクエスト（GET/HEAD/OPTIONS 以外）    → "lpd.write"
//   3. 読み取り系（GET/HEAD/OPTIONS）                           → 不要（null）
//
// 挙動（環境変数 CAP_ENFORCE で二段階）:
//   - CAP_ENFORCE="on"       → capability 不足時に 403 JSON でブロック（proxy.ts 側で実施）
//   - それ以外（未設定含む） → ブロックせず "[cap-monitor]" の warn ログのみ（監視モード）
//
// 検証済み claims が無いリクエスト（AUTH_ENFORCE 監視モードでの素通し等）は
// capability チェックの対象外（proxy.ts 側でスキップする）。

// このアプリのシステムキー。workspace-hub SYSTEM_CATALOG の "lpd" と一致（固定）。
// capability は "<system>.<action>" 形式（例 "lpd.write" / "lpd.send"）。
const CAP_SYSTEM_KEY = 'lpd'

/** 書き込み系リクエスト（GET/HEAD/OPTIONS 以外）が要求する capability。 */
export const CAP_WRITE = `${CAP_SYSTEM_KEY}.write`

/** LINE 送信・配信の実行系エンドポイントが要求する capability。 */
export const CAP_SEND = `${CAP_SYSTEM_KEY}.send`

// LINE 送信・配信の「実行系」エンドポイントのパスマップ。
// ここに一致するリクエストは lpd.write ではなく lpd.send を要求する。
//   - POST /api/v1/pdfs/send     … 選択した PDF を宛先へ LINE push 配信する（送信の実行）
//   - POST /api/v1/messages/send … 汎用テキストの LINE push 配信（template-library 等の外部からも利用）
// パスマップ対象外（proxy の /api/v1 ゲート自体を通らない送信系。参考として明記）:
//   - /api/cron/reminders … リマインダー自動送信。CRON_SECRET の Bearer で別途保護（JWT 無し・matcher 除外）
//   - /api/webhook/line   … LINE からの受信 webhook。署名検証で別途保護（matcher 除外）
const SEND_PATHS: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/v1\/pdfs\/send$/ },
  { method: 'POST', pattern: /^\/api\/v1\/messages\/send$/ },
]

// capability を要求しない読み取り系メソッド。
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * capability の enforce（ブロック）が有効かどうか。
 * CAP_ENFORCE="on" のときだけ true。既定（未設定 / その他の値）は false（監視モード）。
 * auth-gate の AUTH_ENFORCE とは独立したフラグ。
 */
export function isCapEnforced(): boolean {
  return (process.env.CAP_ENFORCE || '').trim().toLowerCase() === 'on'
}

/**
 * メソッド＋パスから、このリクエストが要求する capability を求める。
 * 読み取り系（不要）なら null。
 */
export function requiredCapability(
  method: string,
  pathname: string,
): string | null {
  const m = method.toUpperCase()
  for (const entry of SEND_PATHS) {
    if (entry.method === m && entry.pattern.test(pathname)) return CAP_SEND
  }
  if (READ_METHODS.has(m)) return null
  return CAP_WRITE
}

/**
 * 検証済み capabilities に対する不足判定。
 * 不足していれば不足 capability 名を返し、満たしていれば null。
 */
export function missingCapability(
  capabilities: readonly string[],
  method: string,
  pathname: string,
): string | null {
  const required = requiredCapability(method, pathname)
  if (!required) return null
  return capabilities.includes(required) ? null : required
}

/**
 * 数量上限（limits claim）のヘルパー（配管のみ。呼び出しは将来のリソース上限実装で追加する）。
 *
 * JWT の limits claim（例 { "lpd.recipients": 100 }）から "<system>.<resourceKey>" の
 * 値を数値検証して返す。無い / 数値でない場合は null（= 無制限）。
 */
export function limitFor(
  claims: { limits?: Record<string, unknown> } | null | undefined,
  resourceKey: string,
): number | null {
  const value = claims?.limits?.[`${CAP_SYSTEM_KEY}.${resourceKey}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
