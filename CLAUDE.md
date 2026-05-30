# LINE PDF DELIVERY（line-pdf-delivery）

PDF 一括取り込み → テキスト抽出 → LINE 個別配信システム。送信履歴・リマインダー機能あり。

## 技術スタック

- Next.js（App Router）+ TypeScript
- **Prisma + Supabase PostgreSQL**（※ 他プロジェクトは生 Supabase クライアント直叩きが多いが、ここは Prisma ORM 経由）
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
├── prisma/              # schema.prisma + migrations
├── supabase/            # Supabase 設定（補助）
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
# Prisma クライアント生成
npx prisma generate

# Migration 適用（本番反映）
npx prisma migrate deploy

# Studio（DB 確認 GUI）
npx prisma studio
```

## 注意事項

- **Prisma を使う唯一のプロジェクト**: スキーマ変更は `prisma/schema.prisma` を正本に、`prisma migrate dev` で migration 生成 → commit。生の SQL migration は併用しない
- **LINE Messaging API のチャンネルアクセストークン**: Doppler `line-pdf-delivery` に格納。サーバー側専用
- **PDF テキスト抽出**: ファイルサイズ大の場合タイムアウトに注意（Vercel Functions の 60s 上限）
- **`/dl/` パス**: 公開ダウンロードリンク。署名 or トークンでアクセス制御している前提を崩さない

## デプロイ

- 本番: `https://lpd.utinc.dev`
- main マージで Vercel 自動デプロイ

Git / Supabase / Doppler / Vercel 運用はグローバル `~/.claude/CLAUDE.md` に準拠。
