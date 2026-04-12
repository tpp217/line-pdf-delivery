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
