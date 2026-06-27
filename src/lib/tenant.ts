// テナント解決ヘルパ（テナントデータ分離・SECURITY-CRITICAL）
//
// lpd は service_role クライアント1つで DB に接続する（src/lib/supabase.ts）。
// service_role は RLS を素通しするため、テナント分離の「主たる防御」はアプリ層
// （各データルートで tenant_id を強制）が担う。本ヘルパはその tenant_id を
// 「呼び出し元」から安全に解決する。
//
// 解決経路は文脈で異なる:
//   1) ログインユーザーのルート（/api/v1/*）
//      → workspace-hub の wh_token cookie（JWT）の tenant_id claim。
//        getRequestClaims（auth-gate）で JWKS 検証済みの claims から取り出す。
//        取れなければ fail-closed（401 / 空）。決してクロステナントを返さない。
//   2) JWT を持たないサーバー間/Webhook/cron
//      → 現状テナントは utinc 単一。DEFAULT_TENANT_ID（既定 utinc）で解決する。
//        将来テナントが増えたら各経路に明示の tenant 受け渡しを足す。

import type { NextRequest } from 'next/server'
import { getRequestClaims } from '@/lib/auth-gate'

// 現状唯一の利用者 utinc。JWT を持たない経路（webhook / cron / サーバー間 send）の
// 既定テナント。DEFAULT_TENANT_ID で上書き可（将来テナントが増えた場合の保険）。
export const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID || '993aba82-bfa2-4fc8-ada9-928e2875120f'

/**
 * ログインユーザーのリクエストから tenant_id を解決する。
 *
 * wh_token cookie / Authorization: Bearer の JWT を JWKS 検証し、tenant_id claim を返す。
 * 検証に通らない / tenant_id claim が無い場合は null（fail-closed）。
 *
 * 重要: 監視モード（AUTH_ENFORCE 未設定）でも、tenant_id が解決できなければ null を返す。
 *   呼び出し側はこれを「クロステナントを返さない」ために空応答 / 401 として扱う。
 */
export async function resolveTenantId(req: NextRequest): Promise<string | null> {
  const claims = await getRequestClaims(req)
  const tid = claims?.tenant_id
  return typeof tid === 'string' && tid.length > 0 ? tid : null
}

/**
 * fail-closed 用の 401 レスポンス。tenant_id が解決できないデータ要求に使う。
 */
export function unauthenticatedTenant(): Response {
  return Response.json(
    { error: '未認証です（ログインしてから操作してください）' },
    { status: 401 },
  )
}
