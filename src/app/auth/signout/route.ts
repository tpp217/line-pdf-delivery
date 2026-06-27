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
//   - 単体版（STANDALONE）→ /login（自前ログイン）。加えて Supabase Auth
//     セッションを signOut で破棄する（単体版は wh_token を持たず、認証実体は
//     Supabase の cookie セッションのため）。
//
// GET も同義で許可する（直リンク・ブックマークからのログアウト用）。

import { NextResponse, type NextRequest } from 'next/server'
import { isStandalone } from '@/lib/app-mode'
import { createAuthServerClient } from '@/lib/supabase-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// SSO セッション cookie 名。callback / proxy と揃える。
const WH_TOKEN_COOKIE = 'wh_token'

async function handle(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url)
  const standalone = isStandalone()
  // 単体版は自前ログイン /login、プラットフォーム版は wh SSO 入口 /auth/login。
  const dest = standalone ? '/login' : '/auth/login'
  const response = NextResponse.redirect(`${url.origin}${dest}`, { status: 303 })
  // wh_token を即時失効。SSO 試行印（proxy のループ防止 cookie）も念のため消す。
  // （プラットフォーム版はこの 2 cookie の削除だけで従来どおりログアウト＝挙動不変。）
  response.cookies.set(WH_TOKEN_COOKIE, '', { maxAge: 0, path: '/' })
  response.cookies.set('wh_sso_attempt', '', { maxAge: 0, path: '/' })

  // 単体版のみ: Supabase Auth セッションを破棄する。
  //   signOut が削除すべきセッション cookie を response に払い出すよう、
  //   request の cookie を読み、response.cookies へ書き戻す CookieBridge を渡す。
  if (standalone) {
    try {
      const supabase = createAuthServerClient({
        getAll: () =>
          request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options)
          }
        },
      })
      await supabase.auth.signOut()
    } catch {
      // 認証 env 未設定などで失敗しても、/login へは必ず戻す（ログアウト導線を塞がない）。
    }
  }

  return response
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
