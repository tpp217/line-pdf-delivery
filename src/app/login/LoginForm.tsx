'use client'

// 単体版（STANDALONE）ログインフォーム。
//
// 仕組み:
//   - createAuthBrowserClient().auth.signInWithPassword で email/password 認証。
//   - 成功すると @supabase/ssr のブラウザクライアントが認証 cookie を確立する。
//   - その後 next（既定 /）へ window.location で遷移（フルロードでサーバー側 proxy /
//     Server Component が新しい cookie を読めるようにする）。
//
// 失敗時はメッセージのみ表示し、入力は保持する（再入力の手間を減らす）。
// このコンポーネントは /login（単体版のみレンダリングされる）からのみ使われる。

import { useState } from 'react'
import { createAuthBrowserClient } from '@/lib/supabase-auth'

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const supabase = createAuthBrowserClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        // 具体的な理由は出さず（攻撃者へのヒントを避ける）一般化したメッセージにする。
        setError('メールアドレスまたはパスワードが正しくありません')
        setLoading(false)
        return
      }
      // フルロードで遷移し、サーバー側が新しいセッション cookie を読めるようにする。
      window.location.assign(next)
    } catch {
      setError('ログインに失敗しました。時間をおいて再度お試しください')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: '100%',
          maxWidth: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 28,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <h1
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text)',
              margin: 0,
            }}
          >
            LINE PDF にログイン
          </h1>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '6px 0 0' }}>
            メールアドレスとパスワードを入力してください。
          </p>
        </div>

        <label style={labelStyle}>
          <span style={labelTextStyle}>メールアドレス</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          <span style={labelTextStyle}>パスワード</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={inputStyle}
          />
        </label>

        {error && (
          <p
            role="alert"
            style={{ fontSize: 12.5, color: '#dc2626', margin: 0 }}
          >
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} style={buttonStyle(loading)}>
          {loading ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const labelTextStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-2)',
}

const inputStyle: React.CSSProperties = {
  height: 38,
  padding: '0 12px',
  fontSize: 13.5,
  color: 'var(--text)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  outline: 'none',
}

function buttonStyle(loading: boolean): React.CSSProperties {
  return {
    height: 40,
    marginTop: 4,
    fontSize: 13.5,
    fontWeight: 600,
    color: '#fff',
    background: loading ? 'var(--text-3)' : 'var(--text)',
    border: 'none',
    borderRadius: 6,
    cursor: loading ? 'default' : 'pointer',
  }
}
