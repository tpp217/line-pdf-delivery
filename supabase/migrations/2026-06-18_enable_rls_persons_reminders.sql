-- 2026-06-18: persons / reminders / category_recipients に RLS を有効化
--   （Supabase advisor 0013 ERROR「RLS Disabled in Public」＝PostgREST 経由の PII 露出を塞ぐ）
--
-- lpd は service_role クライアント1つだけで DB アクセス（src/lib/supabase.ts・
--   anon/browser/publishable クライアントは存在しない＝origin/main で確認）。
--   service_role は BYPASSRLS で素通しするためアプリ動作は無影響。
--   policy は作らない＝anon/authenticated からは遮断（= 露出解消）。可逆（disable で戻せる）。
--
-- ★ ops DB(urzflutzgcioqswzmpkz) へ Supabase Management API で適用済み＋検証済み（2026-06-18）:
--   RLS=true（3表）・service_role で persons=27/reminders=1/category_recipients=9 を読込可。

alter table public.persons enable row level security;
alter table public.reminders enable row level security;
alter table public.category_recipients enable row level security;
