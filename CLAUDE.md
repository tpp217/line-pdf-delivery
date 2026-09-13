# LINE PDF DELIVERY（line-pdf-delivery）

PDF 一括取り込み → テキスト抽出 → LINE 個別配信システム。送信履歴・リマインダー機能あり。

## 技術スタック

- Next.js（App Router）+ TypeScript
- **Supabase PostgreSQL**（生 Supabase クライアント直叩き。`src/lib/supabase.ts` で `SUPABASE_SERVICE_KEY` を使いサーバー側のみで利用）
- Tailwind CSS
- Vercel ホスティング
- LINE Messaging API

## ディレクトリ

```
line-pdf-delivery/
├── src/app/             # App Router
│   ├── api/v1/
│   │   ├── pdfs/        # PDF CRUD・配信
│   │   ├── persons/     # 送信先管理
│   │   └── reminders/   # リマインダー
│   └── dl/              # ダウンロードリンク
├── supabase/            # migrations（生 SQL。スキーマ正本）
├── prisma/              # schema.prisma の名残（未使用・参照のみ）
├── docs/                # 設計書（DB Schema / API / ENV）
└── public/
```

## 主要画面（operation-hub サイドバーから遷移）

- `/pdfs` — PDF 管理
- `/reminders` — リマインダー
- `/recipients` — 送信先
- `/history` — 送信履歴

## 開発コマンド

```bash
# 依存インストール
npm install

# Lint
npm run lint
```

スキーマ変更は `supabase/migrations/` に生 SQL を追加し、Supabase CLI（`npx supabase db push`）で適用する。Prisma は使用していない（`npx prisma *` は依存未導入のため動かない）。

## 注意事項

- **データ層は生 Supabase クライアント直叩き**: 全 API ルートが `src/lib/supabase.ts` の `supabase.from(...)` を使用。スキーマ変更は `supabase/migrations/` に生 SQL を追加して管理する（`prisma/schema.prisma` は移行前の名残で未使用。整理時に削除候補）
- **LINE Messaging API のチャンネルアクセストークン**: Doppler `line-pdf-delivery` に格納。サーバー側専用
- **PDF テキスト抽出**: ファイルサイズ大の場合タイムアウトに注意（Vercel Functions の 60s 上限）
- **`/dl/` パス**: 公開ダウンロードリンク。署名 or トークンでアクセス制御している前提を崩さない
- **人物の同定（ファイル名の表記ゆれ）**: 取り込み時の人物解決は `src/lib/person-match.ts`。
  「エイリアス（人が確定済み）→ 正規化キーの完全一致 → 新規作成」の順で、**あいまい一致で
  自動統合はしない**（他人の給与明細を配信する事故を防ぐため）。姓のみ↔フルネームや
  1文字違いは PDF 管理画面の「要確認」で人が確定し、結果が `person_aliases` に学習される。
  正規化ルールは `src/lib/person-key.ts`、書類名の辞書は `person_key_tokens`（画面から追加）。
  正規化キーは列として持たず都度計算する（辞書変更を即反映するため・設計メモは
  `supabase/migrations/2026-09-13_person_matching.sql`）

## デプロイ

- 本番: `https://lpd.utinc.dev`
- main マージで Vercel 自動デプロイ

Git / Supabase / Doppler / Vercel 運用はグローバル `~/.claude/CLAUDE.md` に準拠。
