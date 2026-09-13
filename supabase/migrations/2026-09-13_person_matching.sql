-- 2026-09-13: 人物同定を「ファイル名の完全一致」から「正規化キー＋人の確認」へ
--
-- 背景:
--   PDF 取り込み（src/app/api/v1/uploads/folder/route.ts）は
--   「拡張子を除いたファイル名 ＝ 人物名」で persons を (tenant_id, name) 完全一致
--   upsert していた。クライアント側にファイル名の統一ルールが無いため
--     奥村華月.pdf / 給与支払明細書_奥村華月.pdf / 給与明細 奥村華月 202604.pdf
--   がすべて別人として登録され、カテゴリ未設定のまま量産される。
--   カテゴリは PDF 管理画面の絞り込みと送信先解決（category_recipients）を兼ねるので、
--   これは「一括送信から黙って漏れる」事故になる（本番 persons 101 行＝実質 51 人、
--   28 重複グループ中 24 グループでカテゴリの付き外れが割れていた）。
--
-- この migration が作るもの（すべて additive・既存表と既存行には一切触れない）:
--   1) person_key_tokens        … 書類名トークンの辞書（テナントごとに画面から追加）
--   2) person_aliases           … 人が「同一人物」と確定した紐付けの学習結果
--   3) person_match_dismissals  … 人が「別人」と確定したペア（候補に再提示しない）
--
-- 設計メモ:
--   正規化キーそのものは列として持たない（src/lib/person-key.ts でその都度計算する）。
--   辞書に 1 語足すたびに全行の再計算が要るのを避けるためで、persons はテナント
--   あたり数百件規模なので必要なときに全件読んで突き合わせる方が常に整合する。
--
--   既存 persons 行は統合しない（＝同一キーの重複行がそのまま残る）ため、
--   (tenant_id, 正規化キー) の UNIQUE は張れない／張らない。同一キーに複数行が
--   当たった場合は「カテゴリが設定済みの行」を優先してアプリ側で解決する
--   （src/lib/person-key.ts の pickBestPerson）。これにより既存行を触らないまま
--   新規アップロードは正しい側へ吸い寄せられる。
--
--   service_role は BYPASSRLS で素通しするため、RLS ポリシーは将来の
--   user-token クライアント向けの多層防御（既存 20260627122618 と同じ方針）。

begin;

-- ── 1) 書類名トークン辞書 ─────────────────────────────────
--   「給与支払明細書」「賞与明細」などクライアント固有の語を画面から足せるようにする。
--   汎用の既定語は src/lib/person-key.ts の DEFAULT_DOC_TOKENS 側に持ち、
--   この表の内容と合成して使う（この表が空でも既定語だけで動く）。
create table if not exists public.person_key_tokens (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text        not null,
  token      text        not null,
  created_at timestamptz not null default now()
);

create unique index if not exists person_key_tokens_tenant_token_key
  on public.person_key_tokens (tenant_id, token);

-- ── 2) エイリアス（人が確定した「同一人物」の学習結果）──────────
--   統合時に、消える側の名前の正規化キーを残る人物へ向けて登録する。
--   次回以降そのファイル名が来たら正規化一致を待たずに直接この人物へ紐付く。
--   alias_key はテナント内で一意（1 つのキーが 2 人を指すことはない）。
create table if not exists public.person_aliases (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text        not null,
  alias_key  text        not null,
  person_id  uuid        not null references public.persons(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists person_aliases_tenant_key_key
  on public.person_aliases (tenant_id, alias_key);
create index if not exists idx_person_aliases_person_id
  on public.person_aliases (person_id);

-- ── 3) 却下済みペア（人が「別人」と確定した組み合わせ）────────────
--   同姓・似た氏名を毎回候補として出し続けないための記録。
--   person_id_a < person_id_b の順で入れる（アプリ側で並べ替えてから insert）。
create table if not exists public.person_match_dismissals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text        not null,
  person_id_a  uuid        not null references public.persons(id) on delete cascade,
  person_id_b  uuid        not null references public.persons(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create unique index if not exists person_match_dismissals_pair_key
  on public.person_match_dismissals (tenant_id, person_id_a, person_id_b);
create index if not exists idx_person_match_dismissals_a
  on public.person_match_dismissals (person_id_a);
create index if not exists idx_person_match_dismissals_b
  on public.person_match_dismissals (person_id_b);

-- ── 4) RLS（多層防御）──────────────────────────────────
--   既存表（20260627122618）と同じく service_role は素通しするのでアプリ挙動は無影響。
--   authenticated には JWT の tenant_id claim と一致する行だけを見せる。
alter table public.person_key_tokens       enable row level security;
alter table public.person_aliases          enable row level security;
alter table public.person_match_dismissals enable row level security;

do $$
declare
  t text;
  tables text[] := array['person_key_tokens','person_aliases','person_match_dismissals'];
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

commit;
