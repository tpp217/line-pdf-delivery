// Proxy（旧 middleware）— 認証ゲート（監視モード）
//
// Next.js 16 では middleware は proxy に改称され、ランタイムは nodejs 固定。
// そのため jose の createRemoteJWKSet（リモート JWKS 取得）が問題なく動く。
//
// 役割: 監査で「無認証」と判定された主要 API（/api/v1/*）に対して、
// workspace-hub 発行の JWT を JWKS 検証するゲートを 1 か所で挟む。
// 既存の各 route ファイルには手を入れず、最小差分で導入する。
//
// 非破壊が最優先:
//   - 既定（AUTH_ENFORCE 未設定 / "on" 以外）は「監視モード」。
//     トークンの有無・検証可否を console に記録するだけで素通しする。
//   - AUTH_ENFORCE="on" のときだけ 401/403 でブロックする。
//   - したがってマージ・デプロイしても、AUTH_ENFORCE を設定しない限り
//     現行の挙動（無認証で通る）は一切変わらない。

import { NextResponse, type NextRequest } from 'next/server'
import {
  isAuthEnforced,
  verifyGate,
  summarizeClaims,
  type GateFailureReason,
} from '@/lib/auth-gate'

// 監視ログの接頭辞。Vercel のログで grep しやすくする。
const LOG_PREFIX = '[auth-gate]'

// 失敗理由 → enforce 時の HTTP ステータス。
function statusFor(reason: GateFailureReason): number {
  // 認証情報が無い / 不正 → 401、権限（systems）外 → 403。
  return reason === 'system_forbidden' ? 403 : 401
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const enforce = isAuthEnforced()
  const { pathname } = request.nextUrl
  const method = request.method

  const result = await verifyGate(request.headers.get('authorization'))

  if (result.ok) {
    // 検証成功。監視モードでも enforce でも素通しだが、観測のため記録する。
    console.log(
      `${LOG_PREFIX} ok method=${method} path=${pathname} enforce=${enforce}`,
      summarizeClaims(result.claims),
    )
    return NextResponse.next()
  }

  // 検証失敗（トークン無し / 不正 / 権限外）。
  if (enforce) {
    console.warn(
      `${LOG_PREFIX} blocked method=${method} path=${pathname} reason=${result.reason}`,
    )
    const status = statusFor(result.reason)
    return NextResponse.json(
      { error: 'Unauthorized', reason: result.reason },
      { status },
    )
  }

  // 監視モード: ブロックせず記録のみ。ここを通っても従来どおり処理は続行される。
  console.warn(
    `${LOG_PREFIX} monitor method=${method} path=${pathname} reason=${result.reason} (enforce=off, passthrough)`,
  )
  return NextResponse.next()
}

// 監査で無認証だった主要 API（/api/v1 配下）にのみゲートを掛ける。
// 意図的に対象外:
//   - /dl/*           … エンドユーザーが LINE から開く公開 DL（短縮URL/landing）。認証を掛けない。
//   - /api/webhook/*  … LINE 署名検証で別途保護済み。
//   - /api/cron/*     … CRON_SECRET の Bearer で別途保護済み。
export const config = {
  matcher: ['/api/v1/:path*'],
}
