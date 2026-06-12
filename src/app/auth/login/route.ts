// GET /auth/login
//
// workspace-hub の authorize へ誘導する SSO 入口（ランチャーを経由しない直接アクセス用）。
// workspace-hub にログイン済み（24時間セッション）なら無音で code が発行され再ログイン不要。
// 未ログインなら authorize が /login へ流す（従来と同じ）。
// ログイン成功後は /auth/callback に one-time code 付きで戻り、wh_token セッションが確立する。
// 既にランチャーでログイン済みのブラウザなら、authorize 経由（ランチャーのリンク）で
// 再ログインなしに着地するため、この入口は主に直接アクセス・ブックマーク用。

import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AUTH_ORIGIN = process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  // ログイン後の戻り先（同一オリジンのパスのみ。オープンリダイレクト防止）。
  const nextRaw = url.searchParams.get('next')
  const next =
    nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/'
  const callback = new URL('/auth/callback', url.origin)
  if (next !== '/') callback.searchParams.set('next', next)
  return NextResponse.redirect(
    `${AUTH_ORIGIN}/api/auth/sso/authorize?redirect_uri=${encodeURIComponent(callback.toString())}`,
    { status: 302 },
  )
}
