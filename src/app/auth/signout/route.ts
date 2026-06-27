// POST /auth/signout
//
// ログアウト。SSO セッション cookie（wh_token）を失効させて入口へ戻す。
// ヘッダの「ログアウト」アイコン（form POST）から呼ばれる。
//
// 非破壊・additive:
//   - 新規ルート。既存コードからの参照は無く、設定しない限り誰も叩かない。
//   - proxy の matcher は /auth/ を除外しているため、このルートは認証ゲートの対象外。
//   - cookie を 1 つ消すだけで、サーバー状態（DB・wh セッション）には触れない。
//
// 遷移先:
//   - プラットフォーム版 → /auth/login（wh SSO 入口。wh セッションが生きていれば
//     無音で再 mint され、結果的に「別アカウントで入り直す」導線になる）。
//   - 単体版（STANDALONE）→ /login（自前ログイン。※単体版ログインは未整備・要実装）。
//
// GET も同義で許可する（直リンク・ブックマークからのログアウト用）。

import { NextResponse, type NextRequest } from 'next/server'
import { isStandalone } from '@/lib/app-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SSO セッション cookie 名。callback / proxy と揃える。
const WH_TOKEN_COOKIE = 'wh_token'

function handle(request: NextRequest): NextResponse {
  const url = new URL(request.url)
  // 単体版は自前ログイン /login（未整備）、プラットフォーム版は wh SSO 入口 /auth/login。
  const dest = isStandalone() ? '/login' : '/auth/login'
  const response = NextResponse.redirect(`${url.origin}${dest}`, { status: 303 })
  // wh_token を即時失効。SSO 試行印（proxy のループ防止 cookie）も念のため消す。
  response.cookies.set(WH_TOKEN_COOKIE, '', { maxAge: 0, path: '/' })
  response.cookies.set('wh_sso_attempt', '', { maxAge: 0, path: '/' })
  return response
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
