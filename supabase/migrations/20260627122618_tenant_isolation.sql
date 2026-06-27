-- 20260627122618: テナントデータ分離（tenant isolation）
--
-- 背景（SECURITY-CRITICAL）:
--   lpd は src/lib/supabase.ts の service_role クライアント1つで業務データを
--   tenant フィルタ無しにクエリしていた。workspace-hub SSO のマルチテナント前提で
--   どのテナントのログインユーザーでも全テナントのデータ（PDF・会社名・氏名・送信先・
--   送信履歴）が見える＝クロステナント漏洩だった。
--   主たる防御はアプリ層（各データルートで tenant_id を強制）。本 migration は
--   ①各表に tenant_id 列を追加し既存行を utinc で backfill ②RLS の tenant ポリシーを
--   追加する「多層防御（将来の user-token クライアント用）」。
--
-- 重要:
--   - service_role は BYPASSRLS で素通しするため、RLS ポリシー追加でアプリ挙動は無影響。
--     現状の防御はアプリ層（.eq('tenant_id', ...) / insert 時の tenant_id 付与）が担う。
--   - additive のみ（列追加・索引・ポリシー追加）。既存列やデータの破壊・変更はしない。
--   - 既存行は全て唯一の利用者 utinc のものなので utinc テナントIDで backfill する。
--   - 1 トランザクションで適用（途中失敗時は全ロールバック）。
--
-- ★ 本 migration は prod 未適用。ops DB(urzflutzgcioqswzmpkz) への適用は親が実施する。

begin;

-- ───────────────────────────────────────────────────────────
-- utinc テナント（現状唯一の利用者）。既存行はすべてこのテナントに属する。
-- ───────────────────────────────────────────────────────────
-- 993aba82-bfa2-4fc8-ada9-928e2875120f = utinc

-- ── 1) tenant_id 列の追加（additive・text 型。member_directory と同型・JWT claim と同型）──
alter table public.pdf_documents       add column if not exists tenant_id text;
alter table public.recipients          add column if not exists tenant_id text;
alter table public.send_batches        add column if not exists tenant_id text;
alter table public.send_jobs           add column if not exists tenant_id text;
alter table public.delivery_events     add column if not exists tenant_id text;
alter table public.persons             add column if not exists tenant_id text;
alter table public.reminders           add column if not exists tenant_id text;
alter table public.routing_rules       add column if not exists tenant_id text;
alter table public.category_recipients add column if not exists tenant_id text;
alter table public.pdf_upload_batches  add column if not exists tenant_id text;

-- ── 2) 既存行の backfill（NULL のみ。再実行しても二重更新しない）──
update public.pdf_documents       set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.recipients          set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.send_batches        set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.send_jobs           set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.delivery_events     set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.persons             set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.reminders           set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.routing_rules       set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.category_recipients set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;
update public.pdf_upload_batches  set tenant_id = '993aba82-bfa2-4fc8-ada9-928e2875120f' where tenant_id is null;

-- ── 3) tenant_id 索引（テナント絞り込みクエリ用）──
create index if not exists idx_pdf_documents_tenant_id       on public.pdf_documents (tenant_id);
create index if not exists idx_recipients_tenant_id          on public.recipients (tenant_id);
create index if not exists idx_send_batches_tenant_id        on public.send_batches (tenant_id);
create index if not exists idx_send_jobs_tenant_id           on public.send_jobs (tenant_id);
create index if not exists idx_delivery_events_tenant_id     on public.delivery_events (tenant_id);
create index if not exists idx_persons_tenant_id             on public.persons (tenant_id);
create index if not exists idx_reminders_tenant_id           on public.reminders (tenant_id);
create index if not exists idx_routing_rules_tenant_id       on public.routing_rules (tenant_id);
create index if not exists idx_category_recipients_tenant_id on public.category_recipients (tenant_id);
create index if not exists idx_pdf_upload_batches_tenant_id  on public.pdf_upload_batches (tenant_id);

-- ── 4) RLS 有効化（既に有効だが冪等に再宣言）＋ tenant ポリシー追加（多層防御）──
--   現状のアプリは service_role(BYPASSRLS) のみで接続するため、このポリシーは
--   将来 user-token（authenticated）クライアントを導入したときの保険。
--   tenant_id が JWT claim 'tenant_id' と一致する行のみ可視/可変にする。
--   既存の service_only ポリシーは残し、authenticated 向けに別ポリシーを追加する。
alter table public.pdf_documents       enable row level security;
alter table public.recipients          enable row level security;
alter table public.send_batches        enable row level security;
alter table public.send_jobs           enable row level security;
alter table public.delivery_events     enable row level security;
alter table public.persons             enable row level security;
alter table public.reminders           enable row level security;
alter table public.routing_rules       enable row level security;
alter table public.category_recipients enable row level security;
alter table public.pdf_upload_batches  enable row level security;

-- 各表に同名ポリシーを冪等に作成（存在すれば drop してから作り直す）。
do $$
declare
  t text;
  tables text[] := array[
    'pdf_documents','recipients','send_batches','send_jobs','delivery_events',
    'persons','reminders','routing_rules','category_recipients','pdf_upload_batches'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I
         as permissive
         for all
         to authenticated
         using (tenant_id = (auth.jwt() ->> %L))
         with check (tenant_id = (auth.jwt() ->> %L))',
      t, 'tenant_id', 'tenant_id'
    );
  end loop;
end $$;

-- ── 5) persons の一意制約をテナント別へ（write 分離に必須）──
--   persons.name はグローバル UNIQUE（persons_name_key）で、persons の upsert は
--   onConflict='name' に依存していた。マルチテナントでは「同名の人物」が別テナントで
--   衝突/上書きされてしまうため、(tenant_id, name) の複合 UNIQUE へ移行する。
--   既存データは名前が全テナント（utinc のみ）で一意なので衝突は起きない（非破壊）。
--   ※ アプリ側 onConflict も 'tenant_id,name' へ更新する（同 PR で対応）。
alter table public.persons drop constraint if exists persons_name_key;
create unique index if not exists persons_tenant_name_key
  on public.persons (tenant_id, name);

-- ── 6) category_recipients について ──
--   PK は (category_name, recipientId)。recipientId は recipients（テナント所有）の
--   外部参照であり、1 つの recipient は 1 テナントに属するため、この PK は事実上
--   テナント横断衝突を起こさない（別テナントが同一 recipientId を持てない）。
--   よって PK 変更は不要。tenant_id 列の追加 + アプリ層の .eq('tenant_id', ...) で十分。

commit;
