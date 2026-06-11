// GET /auth/login
//
// workspace-hub のログイン画面へ誘導する SSO 入口（ランチャーを経由しない直接アクセス用）。
// ログイン成功後は /auth/callback に one-time code 付きで戻り、wh_token セッションが確立する。
// 既にランチャーでログイン済みのブラウザなら、authorize 経由（ランチャーのリンク）で
// 再ログインなしに着地するため、この入口は主に直接アクセス・ブックマーク用。

import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AUTH_ORIGIN = process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const redirectUri = `${url.origin}/auth/callback`
  return NextResponse.redirect(
    `${AUTH_ORIGIN}/login?redirect_uri=${encodeURIComponent(redirectUri)}`,
    { status: 302 },
  )
}
