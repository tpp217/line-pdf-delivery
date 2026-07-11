// 認証ゲート（監視モード対応）
//
// workspace-hub（auth.utinc.dev）が RS256 で署名したアクセストークンを
// JWKS で検証するためのヘルパ。下流システムである本アプリは公開鍵（JWKS）
// だけで検証し、秘密鍵には一切触れない。
//
// 重要な設計方針（本番を絶対に壊さないため）:
//   - 既定は「監視モード」。AUTH_ENFORCE が "on" のときだけブロックする。
//   - 監視モードでは検証の成否を console に記録するのみで、リクエストは素通しする。
//   - したがって本ファイルを導入・デプロイしても、AUTH_ENFORCE 未設定なら
//     現行の挙動（無認証で通る）は一切変わらない。
//
// claims（tenant_id / level / capabilities / systems）は workspace-hub の
// src/lib/jwt.ts（AccessTokenClaims）と整合させている。

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { NextRequest } from 'next/server'

// RS256 固定。発行側（workspace-hub）と同一アルゴリズム前提。
const ALG = 'RS256'

// 期待する発行者。workspace-hub の EXPECTED_ISSUER と一致させる。
const EXPECTED_ISSUER =
  process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev'

// JWKS の取得先。既定は workspace-hub の公開エンドポイント。
const JWKS_URL =
  process.env.JWKS_URL || 'https://auth.utinc.dev/.well-known/jwks.json'

// このアプリを表す下流システムキー。workspace-hub の system_access.system_key
// に対応する。systems[] にこのキーが含まれるかを enforce 時のみ検証する。
// 既定値は workspace-hub SYSTEM_CATALOG の 'lpd' と一致（AUTH_SYSTEM_KEY で上書き可）。
const SYSTEM_KEY = process.env.AUTH_SYSTEM_KEY || 'lpd'

/**
 * enforce（ブロック）が有効かどうか。
 * AUTH_ENFORCE="on" のときだけ true。既定（未設定 / その他の値）は false（監視モード）。
 */
export function isAuthEnforced(): boolean {
  return (process.env.AUTH_ENFORCE || '').toLowerCase() === 'on'
}

/**
 * トークンから取り出す業務 claims。
 * workspace-hub の AccessTokenClaims のサブセット。
 */
export interface GateClaims {
  sub?: string
  tenant_id?: string
  level?: number
  capabilities: string[]
  systems: string[]
  plan?: string
  // workspace-hub の JWT が持つ LINE ユーザー ID。提出者の本人解決に使う。
  line_user_id?: string
  // デモ/テスト用テナント（auth_core.tenants.is_demo）なら true。実テナント（未付与/false）では
  // フロントが画面のモック/シード表示を抑止し初期状態を出す（表示制御のヒント・認可境界ではない）。
  is_demo?: boolean
  // 表示用 additive claim（workspace-hub が付与）。本人氏名 / テナント名 / 主所属の部署名。
  name?: string
  tenant_name?: string
  department?: string
  // 選択中（または home）の部署 ID（UUID）。workspace-hub が付与する additive claim。
  // 部署既定フィルタの基準として使う想定だが、本アプリの業務データ（pdf_documents /
  // recipients / persons / reminders / 送信履歴）には department 次元（列）が無いため、
  // 現状は受信・whoami での受け渡しに留める（フィルタ基準としては未使用）。無くても壊れない。
  department_id?: string
  // 数量上限 claim（workspace-hub が付与。キーは "<system>.<resourceKey>"・値は数値）。
  // 参照は cap-gate の limitFor() 経由で行う（無い場合は無制限扱い）。
  limits?: Record<string, unknown>
}

export type GateResult =
  | { ok: true; claims: GateClaims }
  | { ok: false; reason: GateFailureReason }

export type GateFailureReason =
  | 'missing_token' // Authorization: Bearer ヘッダが無い
  | 'invalid_token' // 署名・期限・issuer 等の検証に失敗
  | 'system_forbidden' // 検証は通ったが systems[] に本アプリのキーが無い

// JWKS は jose 側で内部キャッシュされる。モジュールスコープで 1 度だけ生成し、
// リクエスト毎の再取得を避ける（鍵ローテーション時は jose が自動で再取得する）。
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(JWKS_URL))
  }
  return jwks
}

/**
 * Authorization ヘッダから Bearer トークンを取り出す。無ければ null。
 */
function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  return m ? m[1].trim() : null
}

function toClaims(payload: JWTPayload): GateClaims {
  return {
    sub: typeof payload.sub === 'string' ? payload.sub : undefined,
    tenant_id:
      typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined,
    level: typeof payload.level === 'number' ? payload.level : undefined,
    capabilities: Array.isArray(payload.capabilities)
      ? (payload.capabilities as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [],
    systems: Array.isArray(payload.systems)
      ? (payload.systems as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [],
    plan: typeof payload.plan === 'string' ? payload.plan : undefined,
    line_user_id:
      typeof payload.line_user_id === 'string'
        ? payload.line_user_id
        : undefined,
    // additive claims（無くても壊れない。未付与は false/undefined のまま）。
    is_demo: payload.is_demo === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    tenant_name:
      typeof payload.tenant_name === 'string' ? payload.tenant_name : undefined,
    department:
      typeof payload.department === 'string' ? payload.department : undefined,
    department_id:
      typeof payload.department_id === 'string'
        ? payload.department_id
        : undefined,
    // 数量上限 claim。プレーンなオブジェクトのときだけ受け取る（値の数値検証は limitFor が行う）。
    limits:
      payload.limits &&
      typeof payload.limits === 'object' &&
      !Array.isArray(payload.limits)
        ? (payload.limits as Record<string, unknown>)
        : undefined,
  }
}

/**
 * Authorization ヘッダの Bearer JWT を JWKS で検証する。
 *
 * - 署名 / 有効期限 / issuer を検証（aud は本アプリ側では強制しない）。
 * - 検証に成功し、かつ systems[] に本アプリのキーが含まれていれば ok。
 * - enforce 時のみ systems チェックの失敗を system_forbidden として扱う。
 *   監視モードではこの関数の結果を「記録」にのみ使うため、呼び出し側で
 *   ブロック判定は行わない。
 *
 * この関数自身は副作用（throw）を持たず、常に GateResult を返す。
 */
export async function verifyGate(
  authHeader: string | null,
): Promise<GateResult> {
  const token = extractBearer(authHeader)
  if (!token) {
    return { ok: false, reason: 'missing_token' }
  }

  let claims: GateClaims
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      algorithms: [ALG],
      issuer: EXPECTED_ISSUER,
    })
    claims = toClaims(payload)
  } catch {
    return { ok: false, reason: 'invalid_token' }
  }

  // systems[] に本アプリのキーが含まれるか。含まれていなければ権限外。
  if (!claims.systems.includes(SYSTEM_KEY)) {
    return { ok: false, reason: 'system_forbidden' }
  }

  return { ok: true, claims }
}

// SSO ログイン済みブラウザが張る HttpOnly cookie 名（/auth/callback が張る）。
// proxy.ts が Bearer へ橋渡しするのと同じ cookie をサーバ側でも参照する。
const WH_TOKEN_COOKIE = 'wh_token'

/**
 * NextRequest から有効な claims を取り出す（取れなければ null）。
 *
 * Authorization: Bearer ヘッダを優先し、無ければ wh_token cookie を
 * Bearer トークンとして扱う（proxy.ts と同じ橋渡しをサーバ側で行う）。
 * verifyGate が ok のときだけ claims を返し、それ以外は null。
 */
export async function getRequestClaims(
  req: NextRequest,
): Promise<GateClaims | null> {
  const whToken = req.cookies.get(WH_TOKEN_COOKIE)?.value
  const effectiveAuth =
    req.headers.get('authorization') ?? (whToken ? `Bearer ${whToken}` : null)
  const result = await verifyGate(effectiveAuth)
  return result.ok ? result.claims : null
}

/**
 * 監視ログ用に、claims を機微情報を伏せた要約へ整形する。
 * トークン本文やケイパビリティの中身は出さず、件数・テナント・レベルのみ。
 */
export function summarizeClaims(claims: GateClaims): Record<string, unknown> {
  return {
    sub: claims.sub,
    tenant_id: claims.tenant_id,
    level: claims.level,
    systems: claims.systems,
    capabilities_count: claims.capabilities.length,
    plan: claims.plan,
  }
}

export const AUTH_GATE_CONFIG = {
  JWKS_URL,
  EXPECTED_ISSUER,
  SYSTEM_KEY,
} as const
