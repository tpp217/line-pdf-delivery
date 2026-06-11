// GET /auth/callback?code=...
//
// workspace-hub（auth.utinc.dev）の SSO 着地。one-time code を JWT に交換し、
// HttpOnly cookie（wh_token）としてブラウザセッションに保持する。
// 以後、フロントから /api/v1/* への同一オリジン fetch に cookie が自動で載り、
// proxy（認証ゲート）が Authorization ヘッダ相当として検証できる＝enforce 解禁の前提。
//
// フロー:
//   1. ランチャー（workspace-hub /api/auth/sso/authorize）または /auth/login 経由で
//      ?code= 付きでここに着地する。
//   2. server-to-server で auth.utinc.dev/api/auth/sso/token に SSO_EXCHANGE_SECRET 付きで交換。
//      redirect_uri バインド照合のため「自分自身の callback URL（query 無し）」を提示する。
//   3. 得た JWT を JWKS で検証し、systems[] に 'lpd' が含まれることまで確認（verifyGate を共用）。
//   4. wh_token cookie（HttpOnly / Secure / SameSite=Lax / JWT の TTL と同寿命）を張って / へ 303。
//
// セキュリティ:
//   - SSO_EXCHANGE_SECRET はサーバー専用。クライアントへ露出させない。
//   - 偽 code / 他システム向け code は交換時の redirect_uri 照合と JWKS 検証で弾かれる。
//   - 検証に通らない限り cookie は一切張らない。

import { NextResponse, type NextRequest } from 'next/server'
import { verifyGate } from '@/lib/auth-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 発行元（workspace-hub）。gate と同じ env を共用する（既定は本番 issuer）。
const AUTH_ORIGIN = process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev'

// SSO セッション cookie 名。proxy が Authorization ヘッダ相当として読む。
export const WH_TOKEN_COOKIE = 'wh_token'

interface TokenResponse {
  access_token?: unknown
  expires_in?: unknown
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)

  // 失敗時はトップへ戻す（理由はクエリで最小限・cookie は張らない）。
  const fail = (reason: string) =>
    NextResponse.redirect(`${url.origin}/?sso_error=${encodeURIComponent(reason)}`, {
      status: 302,
    })

  const code = url.searchParams.get('code')
  if (!code || code.length === 0) {
    return fail('missing_code')
  }

  const exchangeSecret = process.env.SSO_EXCHANGE_SECRET
  if (!exchangeSecret || exchangeSecret.length === 0) {
    // 設定漏れをサイレントに通さない（cookie 無しで戻すだけ＝既存挙動は壊さない）。
    console.warn('[sso/callback] SSO_EXCHANGE_SECRET が未設定です')
    return fail('not_configured')
  }

  // redirect_uri バインド照合用: 発行時にバインドされた「自分自身の callback URL」を再構築する
  // （query を含めない origin + pathname。authorize / login が指定する値と一致させる）。
  const redirectUri = `${url.origin}${url.pathname}`

  // --- one-time code を JWT に交換（server-to-server）---
  let accessToken: string
  let expiresIn: number
  try {
    const res = await fetch(`${AUTH_ORIGIN}/api/auth/sso/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${exchangeSecret}`,
      },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
      cache: 'no-store',
    })
    if (!res.ok) {
      // code 無効/消費済み/期限切れ/redirect 不一致など。理由は区別せず戻す。
      return fail('exchange_failed')
    }
    const data = (await res.json()) as TokenResponse
    if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
      return fail('exchange_failed')
    }
    accessToken = data.access_token
    expiresIn =
      typeof data.expires_in === 'number' && data.expires_in > 0
        ? data.expires_in
        : 15 * 60
  } catch {
    return fail('exchange_failed')
  }

  // --- JWKS 検証 + systems[] に 'lpd' が含まれることの確認（gate と同一ロジックを共用）---
  const gate = await verifyGate(`Bearer ${accessToken}`)
  if (!gate.ok) {
    // invalid_token（偽トークン等）/ system_forbidden（lpd 未契約の operator）。
    return fail(gate.reason)
  }

  // --- wh_token cookie を張ってトップへ 303 ---
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const response = NextResponse.redirect(`${url.origin}/`, { status: 303 })
  response.cookies.set(WH_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: 'lax',
    // JWT の有効期限に揃える。期限切れ後はゲート検証で invalid になり再ログインへ。
    maxAge: expiresIn,
    path: '/',
  })
  return response
}
