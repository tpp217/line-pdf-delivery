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
import { isStandalone } from '@/lib/app-mode'
import { createAuthServerClient } from '@/lib/supabase-auth'

// 監視ログの接頭辞。Vercel のログで grep しやすくする。
const LOG_PREFIX = '[auth-gate]'

// 失敗理由 → enforce 時の HTTP ステータス。
function statusFor(reason: GateFailureReason): number {
  // 認証情報が無い / 不正 → 401、権限（systems）外 → 403。
  return reason === 'system_forbidden' ? 403 : 401
}

// 単体版（STANDALONE）の自前ログインゲート。
//
// プラットフォーム版（STANDALONE 未設定）はこの関数を一切呼ばない＝従来挙動のまま（後方互換）。
//
// 仕組み:
//   - Supabase Auth のセッション cookie を検証し、無ければアクセスを止める。
//   - ページ（ナビゲーション GET）は /login へ 302、API（fetch/XHR）は 401 JSON
//     （XHR を HTML ログインへ飛ばさない）。プラットフォームの SSO 救済と同じ住み分け。
//   - /login 自体・SSO 入口は除外（ログインの入口を塞がない／ループさせない）。
//   - セッションが有効なら、@supabase/ssr が refresh で払い出す cookie を載せて素通し。
//
// matcher（ファイル末尾）で _next・dl・webhook・cron・directory・auth は既に除外済み。
// ここでは matcher を通過したリクエスト（ページ全般・/api/v1・/api/whoami・/login）を見る。
async function standaloneGate(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const method = request.method

  // /login と自前認証 API はゲート対象外（入口とログイン処理を素通し）。
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // セッション検証＋（必要なら）cookie refresh。検証に通れば cookie を載せて素通し、
  // 通らなければ未認証として下で扱う。env 未設定（client 生成失敗）は「未設定だから
  // 止める」のではなく安全側に倒し未認証扱い（fail-closed）。
  const response = NextResponse.next()
  let authed = false
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
    authed = !!user
  } catch {
    authed = false
  }

  if (authed) return response

  // 未認証。API は 401 JSON、ページ（ナビゲーション）は /login へ。
  const isApi = pathname.startsWith('/api/')
  const isNavigation =
    method === 'GET' &&
    (request.headers.get('sec-fetch-mode') === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html'))

  if (isApi || !isNavigation) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.nextUrl.origin)
  loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
  console.warn(
    `${LOG_PREFIX} standalone-redirect path=${pathname} (no session) -> /login`,
  )
  return NextResponse.redirect(loginUrl, { status: 302 })
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // 単体版（STANDALONE）: wh JWT は存在しないため wh ゲートは使わず、自前ログイン
  // （Supabase Auth）でアクセスを保護する。プラットフォーム版（フラグ未設定）は
  // この分岐に入らず、以下の wh ゲート（従来挙動）のまま（後方互換）。
  if (isStandalone()) return standaloneGate(request)

  const enforce = isAuthEnforced()
  const { pathname } = request.nextUrl
  const method = request.method
  const isApi = pathname.startsWith('/api/v1/')

  // トークンの取得元は 2 系統:
  //   1. Authorization: Bearer ヘッダ（server-to-server / API クライアント）
  //   2. wh_token cookie（SSO ログイン済みブラウザ。/auth/callback が張る HttpOnly cookie。
  //      同一オリジンの fetch に自動で載るため、フロントのコード変更なしで認証が通る）
  // ヘッダ優先・無ければ cookie をヘッダ相当に橋渡しする（auth-gate 本体は無変更）。
  const headerAuth = request.headers.get('authorization')
  const cookieToken = request.cookies.get('wh_token')?.value
  const effectiveAuth =
    headerAuth ?? (cookieToken ? `Bearer ${cookieToken}` : null)

  // --- ページ（非 API）の自動 SSO 救済 ---
  // enforce 時、未認証のブラウザがページを直接開いた（ブックマーク/直リンク）場合に、
  // SSO ログインへ自動で飛ばして wh_token を取得させる（直接アクセス組の移行を自動化）。
  //   - 監視モード（enforce=off）は一切リダイレクトしない＝従来挙動と完全に同一（非破壊）。
  //   - リダイレクトはトップレベルのページ遷移（navigate / text/html GET）のみ。
  //     fetch/XHR（API クライアント）は API 側の 401 で扱う（無限リダイレクトにしない）。
  //   - ループ防止: 既に sso_error 付きで戻ってきたページは素通し（SSO 失敗→/?sso_error= で
  //     戻った先で再度リダイレクトするとループするため）。/auth・/api/auth は matcher で除外済み。
  if (!isApi) {
    if (!enforce) return NextResponse.next()
    const isNavigation =
      method === 'GET' &&
      (request.headers.get('sec-fetch-mode') === 'navigate' ||
        (request.headers.get('accept') || '').includes('text/html'))
    if (!isNavigation) return NextResponse.next()
    // ループ防止（堅牢版）: 直近で SSO を1回試みた印（短命 cookie）があれば再リダイレクトしない。
    //   SSO 失敗で /?sso_error= に戻った後、アプリが別パス（例 / → /pdfs）へ内部リダイレクトすると
    //   クエリが消えて再び未認証ナビゲーションになる。クエリ依存では防げないため cookie で止める。
    //   この cookie は callback 成功時に消える。60 秒で失効し、その後は再試行できる。
    if (request.cookies.get('wh_sso_attempt')) return NextResponse.next()
    const pageAuth = await verifyGate(effectiveAuth)
    if (pageAuth.ok) return NextResponse.next()
    const loginUrl = new URL('/auth/login', request.nextUrl.origin)
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
    console.warn(
      `${LOG_PREFIX} page-redirect path=${pathname} reason=${pageAuth.reason} -> /auth/login`,
    )
    const res = NextResponse.redirect(loginUrl, { status: 302 })
    res.cookies.set('wh_sso_attempt', '1', {
      httpOnly: true,
      secure: request.nextUrl.hostname !== 'localhost' && request.nextUrl.hostname !== '127.0.0.1',
      sameSite: 'lax',
      maxAge: 60,
      path: '/',
    })
    return res
  }

  const result = await verifyGate(effectiveAuth)

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

// 対象:
//   - /api/v1/*  … 監査で無認証だった主要 API（従来どおりゲート）。
//   - ページ全般 … enforce 時のみ、未認証ナビゲーションを SSO へ救済する（監視時は素通し）。
// 意図的に対象外（matcher で除外＝ループ・公開導線の保護）:
//   - /_next/*・favicon・静的アセット … フレームワーク/静的配信。
//   - /dl/*           … エンドユーザーが LINE から開く公開 DL（短縮URL/landing）。認証不要。
//   - /api/webhook/*  … LINE 署名検証で別途保護済み。
//   - /api/cron/*     … CRON_SECRET の Bearer で別途保護済み。
//   - /api/directory/* … 名簿同期。SSO_EXCHANGE_SECRET の Bearer で別途保護済み（cron と同類）。
//   - /api/auth/*・/auth/* … SSO の入口/着地。リダイレクト対象にするとループする。
// matcher は prefix の negative lookahead のみ（Next.js の制約。拡張子等の複雑な正規表現は不可）。
// 静的アセット（favicon・画像・css/js）はこの matcher に一致しうるが、コード側で
// 「ページの GET ナビゲーションのみリダイレクト」するため実害は無い（Accept が text/html でない
// 静的取得・API fetch は素通し）。
export const config = {
  matcher: ['/((?!_next/|api/webhook|api/cron|api/directory|api/auth|auth/|dl/).*)'],
}
