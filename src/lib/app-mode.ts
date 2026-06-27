// アプリの動作モード（プラットフォーム版 / 単体販売版）を 1 フラグで住み分けるヘルパ。
//
// 背景:
//   このアプリは utinc DX 基盤（workspace-hub の SSO ログイン＋ロスター配布）で動く
//   「プラットフォーム版」が既定だが、各システムを単体でも販売したい（「単体版」）。
//   2 モードを env フラグ STANDALONE 1 本で切り替える。
//
//   | 観点          | プラットフォーム版（既定）              | 単体版（STANDALONE=true）          |
//   |---------------|-----------------------------------------|------------------------------------|
//   | ログイン      | wh SSO（LINE 統一・既存）                | このアプリ自前ログイン（自前完結） |
//   | データ範囲    | wh JWT の tenant_id で分離               | 固定テナント（STANDALONE_TENANT_ID）|
//   | 認証ゲート    | proxy で wh_token を検証（監視/enforce） | wh JWT が無いためゲートを無効化      |
//
// ★最重要原則（後方互換）:
//   STANDALONE 未設定 ＝ 現状のプラットフォーム挙動を一切変えない（完全後方互換）。
//   フラグ ON のときだけ単体版の分岐が効く。判定関数は「ON 以外はすべて false」を返す。
//
// なぜ env か（秘密ではない）:
//   モードは秘密値ではなく公開してよい構成フラグ。サーバー専用ロジック（proxy /
//   Server Component / Route Handler）は STANDALONE を読む。クライアント（'use client'）
//   からも参照したい箇所（トップバーのアイコンの遷移先など）があるため、ビルド時に
//   バンドルへ焼き込まれる NEXT_PUBLIC_STANDALONE も併せて読む。どちらか一方でも
//   真（1/true/on/yes）なら単体版とみなす。
//
//   運用上は両方を同値で設定するのが正（例: STANDALONE=true かつ
//   NEXT_PUBLIC_STANDALONE=true）。サーバー側は STANDALONE を正本とし、
//   NEXT_PUBLIC_STANDALONE はクライアント露出用のミラーとして扱う。

// 文字列を真偽に正規化（1 / true / on / yes を真とみなす。空・未設定・その他は偽）。
function truthy(value: string | undefined | null): boolean {
  const v = (value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

// サーバー側（既定）の単体版判定。STANDALONE を正本とし、無ければ
// NEXT_PUBLIC_STANDALONE にフォールバックする。両方未設定＝プラットフォーム版（false）。
//
// NEXT_PUBLIC_* はビルド時にインライン化される定数参照のため、process.env からの
// 動的アクセスではバンドルに含まれないことがある。ここでは「両方が定数として
// 参照される」ように明示的に 2 つを評価する（サーバー実行時は両方とも実値を持つ）。
export function isStandalone(): boolean {
  return truthy(process.env.STANDALONE) || truthy(process.env.NEXT_PUBLIC_STANDALONE)
}

// クライアント（'use client'）から参照する単体版判定。
// NEXT_PUBLIC_STANDALONE のみを見る（STANDALONE はクライアントに露出しない）。
// 参照式を定数リテラルにすることで Next のビルド時インライン化が効く。
export function isStandaloneClient(): boolean {
  return truthy(process.env.NEXT_PUBLIC_STANDALONE)
}

// 現在のモードを表す文字列（ログ・デバッグ表示用）。
export function appModeLabel(): 'standalone' | 'platform' {
  return isStandalone() ? 'standalone' : 'platform'
}
