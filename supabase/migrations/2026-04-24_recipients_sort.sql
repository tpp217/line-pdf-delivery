-- ===========================================================
-- 2026-04-24: recipients に並び替え用 sortOrder カラムを追加
-- ===========================================================

-- 列を追加（まず nullable で入れる）
alter table public.recipients
  add column if not exists "sortOrder" integer;

-- 既存行に対して createdAt 降順を基準に初期値を振る
with ranked as (
  select id, row_number() over (order by "createdAt" desc) as rn
  from public.recipients
  where "sortOrder" is null
)
update public.recipients r
  set "sortOrder" = ranked.rn
  from ranked
  where r.id = ranked.id;

-- 今後のINSERTで未指定の場合はデフォルト 0（先頭寄り）
alter table public.recipients
  alter column "sortOrder" set default 0;

-- NOT NULL 制約
alter table public.recipients
  alter column "sortOrder" set not null;

-- インデックス
create index if not exists recipients_sort_order_idx
  on public.recipients("sortOrder");
