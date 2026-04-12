# LINE PDF DELIVERY SYSTEM — 設計書

## 概要
PDFフォルダ一括取り込み → テキスト抽出 → LINE個別配信 システムの技術設計書サイト。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html` | 設計書ビューア（Tech Stack / DB Schema / API / ENV） |
| `prisma/schema.prisma` | Prisma スキーマ定義 |
| `openapi/openapi.yaml` | OpenAPI 3.1.0 API 定義 |

## 閲覧方法

`index.html` をブラウザで開く。4タブ構成。
1. TECH STACK — 採用技術スタック一覧
2. DB SCHEMA — テーブル設計（8テーブル）
3. API LIST — 全エンドポイント一覧
4. ENV / WORKER — 環境変数・ジョブ定義

## テーブル一覧

| # | テーブル | 用途 |
|---|---|---|
| 1 | recipients | 送信先LINEユーザー管理 |
| 2 | pdf_upload_batches | フォルダアップロード単位 |
| 3 | pdf_documents | PDFと抽出結果 |
| 4 | routing_rules | 会社名→送信先自動ルール |
| 5 | send_batches | 一括送信バッチ |
| 6 | send_jobs | 個別送信ジョブ（1PDF×1送信先） |
| 7 | delivery_events | 配信イベントログ |
| 8 | app_settings | システム設定（シングルトン） |

## API エンドポイント数

| グループ | 本数 |
|---|---|
| Dashboard | 2 |
| Uploads | 1 |
| PDFs | 6 |
| Recipients | 7 |
| Routing Rules | 5 |
| Send Batches | 7 |
| Send Jobs | 4 |
| History | 2 |
| Settings | 4 |
| Viewer | 1 |
| **合計** | **39** |
