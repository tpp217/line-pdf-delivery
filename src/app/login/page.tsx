// /login — 単体版（STANDALONE）の自前ログイン画面
//
// 表示条件（後方互換の要）:
//   - 単体版（isStandalone()）でのみ email/password ログインフォームを出す。
//   - プラットフォーム版（STANDALONE 未設定）では従来どおり wh SSO 入口
//     （/auth/login）へ即リダイレクトする＝この画面は実質存在しないのと同じ挙動。
//     ヘッダの再ログイン等が誤って /login を指しても SSO に吸収されるため安全。
//
// 認証済みなら素通し:
//   - 既に Supabase Auth セッションがあるユーザーが /login を開いたら、
//     next（同一オリジンのパスのみ）または / へ送り返す（フォームを見せない）。
//
// この画面自体は proxy（matcher）対象だが、proxy は単体版では素通し（NextResponse.next）
// するため、未ログインでも /login にアクセスできる（＝ログインの入口を塞がない）。

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { isStandalone } from '@/lib/app-mode'
import { createAuthServerClient } from '@/lib/supabase-auth'
import LoginForm from './LoginForm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 戻り先の正規化（同一オリジンの絶対パスのみ許可＝オープンリダイレクト防止）。
function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  // プラットフォーム版は自前ログインを持たない。従来の SSO 入口へ委譲する。
  if (!isStandalone()) {
    redirect('/auth/login')
  }

  const sp = await searchParams
  const next = safeNext(sp.next)

  // 既にログイン済みなら戻り先へ。Server Component では cookie は読み取り専用なので
  // setAll は no-op（ここではセッション更新の払い出しはしない。proxy/Action 側で行う）。
  const store = await cookies()
  const supabase = createAuthServerClient({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: () => {},
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    redirect(next)
  }

  return <LoginForm next={next} />
}
