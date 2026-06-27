// 単体版（STANDALONE）の自前ログイン用 Supabase Auth クライアント（anon/publishable キー）。
//
// 役割と棲み分け（重要）:
//   - src/lib/supabase.ts … service_role キーのデータ接続。RLS を素通しし、
//     テナント分離はアプリ層（tenant.ts）で担保。**全データ I/O はこちらのまま**。
//   - 本ファイル        … anon(publishable) キーの「認証専用」クライアント。
//     Supabase Auth（email/password）でログイン状態（cookie セッション）だけを扱う。
//     DB へのデータ読み書きはしない（＝service_role 接続は一切置き換えない）。
//
// なぜ別クライアントか:
//   service_role キーはブラウザに出せない。自前ログインは「正規ユーザーかどうか」の
//   入室判定だけが要るので、公開してよい publishable キー＋Supabase Auth で完結させる。
//   テナントは env 固定（STANDALONE_TENANT_ID）なので、認証＝入室可否の判定に徹する。
//
// 後方互換:
//   このファイルは単体版（isStandalone()）のコードパスからのみ import される。
//   プラットフォーム版（STANDALONE 未設定）の実行経路はこれに一切触れない。
//
// env（無ければ .env.example 参照）:
//   NEXT_PUBLIC_SUPABASE_URL            … Supabase プロジェクト URL（公開可）
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY … publishable / anon キー（公開可・RLS 前提）
//
// @supabase/ssr の cookie 方式:
//   ブラウザ（createBrowserClient）と、サーバー（createServerClient＋cookie 橋渡し）で
//   同じセッション cookie を共有する。Next.js App Router の標準作法に合わせる。

import {
  createBrowserClient,
  createServerClient,
  type CookieOptions,
} from '@supabase/ssr'

// 公開して良い接続情報（ブラウザにも焼き込まれる）。
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''

// env 未設定を早期に検知する（単体版でログインを使う場合は必須）。
// プラットフォーム版はこの関数を呼ばないため未設定でも無害。
function assertConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      '単体版ログインに必要な NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です',
    )
  }
}

/**
 * ブラウザ（'use client'）用の認証クライアント。
 * /login フォームの signInWithPassword に使う。cookie はライブラリが document 経由で扱う。
 */
export function createAuthBrowserClient() {
  assertConfigured()
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
}

// @supabase/ssr が読み書きする cookie の最小インターフェース。
// Next の cookies()（Server Component / Route Handler）と NextRequest/NextResponse
// （proxy）の双方を 1 つの型で受けられるよう、getAll/setAll を要求する。
export interface CookieBridge {
  getAll(): { name: string; value: string }[]
  setAll(
    cookies: { name: string; value: string; options?: CookieOptions }[],
  ): void
}

/**
 * サーバー（Route Handler / Server Component / proxy）用の認証クライアント。
 *
 * cookie の入出力は呼び出し側が用意する CookieBridge に委譲する。
 *   - Route Handler / Server Component → next/headers の cookies() を橋渡し。
 *   - proxy（NextRequest/NextResponse） → request.cookies / response.cookies を橋渡し。
 *
 * これにより「セッションの自動更新（refresh）→ 新しい cookie の払い出し」を
 * どの実行文脈でも同じコードで扱える（@supabase/ssr の推奨形）。
 */
export function createAuthServerClient(cookies: CookieBridge) {
  assertConfigured()
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (toSet) => cookies.setAll(toSet),
    },
  })
}
