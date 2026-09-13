-- 2026-09-13: 同じ PDF の二重登録を防ぐための内容ハッシュ
--
-- 背景:
--   アップロードはバッチごとに新しい storagePath（`{batchId}/{uuid}.pdf`）を作り
--   pdf_documents へ insert するため、同じファイルを上げ直すと上書きではなく
--   「もう1件」増える。カテゴリで絞って一括送信すると同じ人に同じ PDF が 2 通届く。
--
--   ファイル名では判定できない。運用上ファイル名に年月が入らないので、
--   ある人の 9月分と 10月分は同名になる（本番の 143 件中、同名のペアは 22 組あるが
--   いずれもサイズが異なり＝別の月の書類。真の重複は 0 件だった）。
--   つまり「同名だから重複」とすると、翌月の給与明細を取りこぼす事故になる。
--
--   そこで判定は PDF の中身の SHA-256 で行う。別の月の書類は中身が違うので
--   誤検知しない。同じファイルを上げ直したときだけ一致する。
--
-- 既存行の扱い:
--   一括のバックフィルはしない。新規アップロードと同名・同サイズの既存行が
--   あったときだけ、その数件をその場でストレージから読んでハッシュを計算し、
--   この列に保存する（src/lib/pdf-dedupe.ts）。手動のバックフィル作業を挟まずに
--   済み、触れた行から順に厳密判定へ移行していく。
--
-- 一意制約は張らない:
--   ソフト削除した書類を上げ直す運用は正当なので、同じハッシュが複数行に
--   存在しうる。重複判定はアプリ側で deletedAt is null の行に対してのみ行う。

begin;

alter table public.pdf_documents
  add column if not exists content_hash text;

-- 重複判定は「生きている書類」だけが対象なので部分索引にする。
create index if not exists idx_pdf_documents_tenant_content_hash
  on public.pdf_documents (tenant_id, content_hash)
  where "deletedAt" is null;

-- 既存行のハッシュ未計算分を引くための索引（遅延ハッシュの候補探索用）。
create index if not exists idx_pdf_documents_tenant_name_size
  on public.pdf_documents (tenant_id, "originalFileName", "fileSizeBytes")
  where "deletedAt" is null;

commit;
