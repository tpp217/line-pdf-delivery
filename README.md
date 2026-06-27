# LINE PDF DELIVERY SYSTEM

PDF一括取り込み → テキスト抽出 → LINE個別配信システム。

## 技術スタック

- Next.js (App Router) + TypeScript
- Prisma + Supabase PostgreSQL
- Tailwind CSS
- Vercel (ホスティング)

## セットアップ

```bash
npm install
cp .env.example .env.local  # 接続情報を編集
npx prisma generate
npx prisma migrate deploy
npm run dev
```

## 設計ドキュメント

`docs/` ディレクトリに設計書（DB Schema / API / ENV）があります。

## 動作モード（プラットフォーム版 / 単体販売版）

このアプリは 1 つの env フラグ `STANDALONE` で 2 つのモードを切り替える。

| 観点       | プラットフォーム版（既定）         | 単体販売版（STANDALONE=true）          |
| ---------- | ---------------------------------- | -------------------------------------- |
| ログイン   | workspace-hub の SSO（LINE 統一）  | 自前ログイン（Supabase Auth・/login）  |
| データ範囲 | wh JWT の `tenant_id` で分離       | 固定テナント `STANDALONE_TENANT_ID`    |
| アクセス制御 | proxy が wh_token を検証（監視/enforce） | proxy が Supabase セッションを検証 |

**`STANDALONE` 未設定（既定）＝プラットフォーム版の挙動は一切変わらない**（完全後方互換）。
単体版の分岐はすべて `isStandalone()` ガード下にある。

### 単体版を有効化する env

`.env.example` の「単体販売版（STANDALONE）」節を参照。要点:

```
STANDALONE=true
NEXT_PUBLIC_STANDALONE=true
STANDALONE_TENANT_ID=<この顧客の tenants.id（UUID）>
NEXT_PUBLIC_SUPABASE_URL=<SUPABASE_URL と同じプロジェクト URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable / anon キー（公開可・RLS 前提）>
```

- `NEXT_PUBLIC_SUPABASE_*` は **認証専用**（/login と proxy のセッション検証）。
  DB のデータ読み書きは従来どおり service_role 接続（`SUPABASE_SERVICE_KEY`）のまま。
- どちらも公開して良い値（ブラウザに焼き込まれる）。秘密値ではない。

### 単体版の初期ユーザー作成（自動作成はしない）

ログインできるユーザーは運用者が手動で登録する。アプリは自動でユーザーを作らない。

1. Supabase ダッシュボード → 対象プロジェクト（ops: `urzflutzgcioqswzmpkz`）→
   **Authentication → Users → Add user**。
2. **Email** と **Password** を入力し、**Auto Confirm User** を有効にして作成
   （メール確認フローを使わない＝即ログイン可にする）。
3. 作成したメール/パスワードを顧客に渡す。`/login` から入室できる。

CLI（service_role キー使用・秘密値はリポジトリに残さない）:

```bash
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"<strong-password>","email_confirm":true}'
```

ログアウトはヘッダ右上のアイコン（`/auth/signout`）。単体版では Supabase の
セッションも `signOut` で破棄される。
