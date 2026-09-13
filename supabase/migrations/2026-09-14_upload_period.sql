-- 2026-09-14: 「〇月アップ分」タグ（pdf_documents.upload_period）
--
-- 背景:
--   PDF 管理画面の年／月タブは pdf_documents.uploadedAt（＝DB の default now()）から
--   その場で算出していた。つまり「いつアップロードしたか」でしか分類できていない。
--   実運用ではひと月ずれる: バッチ「社員2026.6」は 2026-07-12 に、
--   「社員2026.7」は 2026-08-14 にアップロードされており、画面上はそれぞれ
--   7月・8月のタブに入っていた。「7月」を選んで一括送信すると 6月分が飛ぶ。
--
--   書類の中身からの判定もできない。extractStatus は 'DONE' が固定で入るだけで
--   テキスト抽出は実装されておらず、本番 143 件すべて extractedText / companyName は
--   NULL（＝支給年月を読み取る材料が無い）。
--
-- 方針:
--   人が選ぶ「〇月アップ分」タグを正本にする。実際のアップロード日時は
--   タグの既定値を出すためだけに使う（過去分の差し替えアップロードがあるため、
--   実日付に引きずられない）。uploadedAt 自体は監査用にそのまま残す。
--
--   タグは pdf_documents 側に持たせる。画面の絞り込みは pdf_documents を
--   読むだけで完結し、バッチとの join を増やさずに済む。あとから付け替える場合も
--   バッチ単位でまとめて update すればよく、正本が 1 か所に収まる。

begin;

alter table public.pdf_documents
  add column if not exists upload_period text;

-- 'YYYY-MM' 以外が入らないようにする（画面・API 双方の入力を素通しさせない）。
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pdf_documents_upload_period_format'
  ) then
    alter table public.pdf_documents
      add constraint pdf_documents_upload_period_format
      check (upload_period is null or upload_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  end if;
end $$;

-- 既存行は実アップロード日（JST）で埋める。
-- 現在の画面はブラウザのローカル時刻（＝JST）で年月タブを作っているので、
-- JST に合わせておけば移行前後で表示が変わらない。
update public.pdf_documents
   set upload_period = to_char("uploadedAt" at time zone 'Asia/Tokyo', 'YYYY-MM')
 where upload_period is null;

create index if not exists idx_pdf_documents_tenant_upload_period
  on public.pdf_documents (tenant_id, upload_period)
  where "deletedAt" is null;

commit;
