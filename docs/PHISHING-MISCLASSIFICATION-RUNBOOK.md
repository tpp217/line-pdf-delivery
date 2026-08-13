# フィッシング誤分類によるアクセス遮断 対応ランブック

`lpd.utinc.dev`（および `utinc.dev` 配下）が、セキュリティベンダーのレピュテーション DB で
**フィッシングサイトと機械判定され、家庭用・ISP のフィルタで遮断される**事象への対応手順。

**2 回発生している（2026-08-03 / 2026-08-13）。3 回目が起きる前提で読むこと。**

---

## 0. これは「サーバー障害」ではない

遮断はレピュテーション DB → 各社フィルタ → **利用者の回線上**で起きる。
アプリも DNS も Vercel も正常なまま、特定の回線からだけ到達できなくなる。
**コード側の修正では復旧しない**（＝デプロイし直しても直らない）。

### 実害の本体は管理画面ではなく配信リンク

`lpd.utinc.dev` は**管理画面と `/dl` の配信リンクを同じホストで配信している**。
遮断されると、LINE で送った PDF のダウンロードリンクが**受信者側で開けない**。
自社スタッフが管理画面を見られないことより、こちらの方が優先度が高い。

### なぜ誤判定されるのか

機械判定が嫌う条件が揃っている。

- `.dev` の比較的新しいドメイン
- `/dl/<不透明なID>` でファイルを配布する URL 構造（フィッシングの典型形と一致する）
- ランディングが「ファイル名＋ダウンロードボタン」だけで、事業者情報が薄い
- `noindex,nofollow`（配信リンクの秘匿という正当な理由だが、機械には「隠している」と映る）

---

## 1. 切り分け（3 分）

| 手順 | 見るもの | 判定 |
|---|---|---|
| 1 | **スマホの Wi-Fi を切ってモバイル回線で開く** | 開ける → **回線側の遮断で確定**（サーバーは無事）。開けない → 2 へ |
| 2 | ブラウザのエラーコード | `DNS_PROBE_FINISHED_NXDOMAIN` / `ERR_NAME_NOT_RESOLVED` → DNS 遮断。`ERR_CONNECTION_TIMED_OUT` → 経路遮断。**404/500 の HTML が出るならフィルタではなくアプリ障害**（このランブックの対象外） |
| 3 | 他サブドメイン（`auth.utinc.dev` 等） | 全部ダメ → ドメイン単位の遮断。`lpd` だけ → ホスト単位の遮断 |
| 4 | 別回線・別の人 | 特定回線だけ → その回線のフィルタ。全員ダメ → ドメイン／サーバー側を疑う |

**危険サイトの赤い警告画面が出るとは限らない。** 家庭用フィルタは DNS を差し替えて遮断する
方式が多く、その場合は「このサイトにアクセスできません」という**ただの接続エラー**に見える。
接続エラーだからサーバーが落ちている、と早合点しないこと。

### サーバー側が無事であることの確認

- DNS が解決するか（`getent hosts lpd.utinc.dev` → Vercel の IP が返れば OK）
- Vercel の Deployments が Ready か、Domains にドメインが紐づいたままか
- Supabase のプロジェクトが ACTIVE_HEALTHY か

---

## 2. 一次対応（その場をしのぐ）

遮断している回線側で解除する。恒久対応ではないが、業務は動く。

- **J:COM**（過去 2 回ともこれ）: Wi-Fi アプリ（HomePass / J:COM MESH Wi-Fi アプリ。Plume ベース）の
  セキュリティ機能のブロック履歴から `utinc.dev` を許可リストへ。端末単位で解除できる場合もある
- 他の ISP・ルーター製品でも「セキュリティ」「ネットガード」「保護者による制限」等の名称で同種の機能がある
- モバイル回線に切り替える

**顧客側で発生した場合**、顧客の回線設定を触ってもらうのは現実的でないことが多い。
その場合は PDF を LINE に直接添付して送る等の代替手段で当座をしのぎ、3 の申請を急ぐ。

---

## 3. 恒久対応：再分類（誤判定解除）の申請

**ここをやらない限り必ず再発する。** レピュテーション DB を直すのが唯一の恒久対応。

### 3.1 まずどこが黒いか調べる

フィルタ製品は複数のベンダーの DB を参照している。**遮断元を特定せずに 1 社だけ申請しても直らない**。
主要ベンダーの判定確認ページで `lpd.utinc.dev` と `utinc.dev` の両方を調べ、黒いところ全部に申請する。

| ベンダー | 備考 |
|---|---|
| **BrightCloud（Webroot）** | **過去 2 回の遮断元。最優先。** Plume 系の家庭用フィルタが参照している |
| Symantec / Broadcom（Blue Coat WebPulse） | 法人プロキシで広く使われる |
| Google Safe Browsing | Chrome / Firefox の警告に直結。黒いと影響が最も大きい |
| Trend Micro（Site Safety Center） | |
| Fortinet（FortiGuard Web Filter） | |
| McAfee / Trellix（Customer URL Ticketing） | |
| Sophos | |
| Cisco Talos | |
| Netcraft / PhishTank | フィッシング報告 DB。ここに載っていると各社に波及する |

> **注意**: 各社の申請フォームの URL は変わることがある。ここに URL を書くと陳腐化するので、
> 各社サイトで「URL categorization change request」「site review」「dispute」等を探すこと。
> 多くはログイン不要で、数営業日で反映される。

### 3.2 申請前に揃える情報

- 対象 URL: `https://lpd.utinc.dev/`、`https://utinc.dev/`（サブドメイン単位で判定されることもあるので両方）
- 事業者名: uniquetrash.inc
- サービスの説明: 契約企業向けに業務書類（PDF）を LINE 経由で配信する B2B の業務システム
- 希望カテゴリ: Business / Business and Economy（Phishing ではない）
- 補足: 一般公開のサービスではなく、受信者は契約企業のスタッフに限られること

### 3.3 申請文テンプレ（英語）

> **Subject:** Incorrect categorization — lpd.utinc.dev classified as Phishing
>
> Hello,
>
> The domain `lpd.utinc.dev` (and its parent `utinc.dev`) is currently categorized as
> phishing/malicious in your database. This is a false positive.
>
> This host is a legitimate B2B document delivery system operated by uniquetrash.inc.
> It distributes business documents (PDF invoices, reports) to staff of our contracted
> client companies via LINE. The download pages under `/dl/` are protected by
> signed, expiring, single-purpose links — they are only reachable by the intended
> recipient, which is why the URL structure may superficially resemble a phishing pattern.
>
> The site does not collect credentials, payment information, or any personal data.
> It does not impersonate any brand or organization. The operator name is displayed
> on every download page.
>
> We request re-categorization as Business / Business and Economy.
>
> This misclassification has already caused real service outages for our users
> (consumer ISP filters blocked the domain entirely), so we would appreciate a review.
>
> Thank you.

日本語で受け付けるベンダーには同趣旨を和訳して出す。
**「資格情報や決済情報を一切収集しない」「ブランドを詐称していない」「運営者名を明示している」**の
3 点が審査の要点なので必ず含めること。

### 3.4 申請後

- 反映まで数営業日かかる。反映後、遮断されていた回線で再度アクセスして確認する
- **申請した日・ベンダー・結果を下の履歴に追記する**。次回の担当者が同じ調査を繰り返さずに済む

---

## 4. 再発防止（構造面の選択肢）

申請で解除されても、URL 構造が同じである限り再発しうる。コスト順に並べる。

| 対策 | コスト | 効果 |
|---|---|---|
| ランディングに事業者名を常設（**実施済み** / PR #43） | 小 | 審査人が正規サービスと判断する材料になる。機械判定への効果は限定的 |
| `/dl` のランディングに、サービス説明・問い合わせ先へのリンクを追加 | 小 | 同上。審査時の心証が上がる |
| `lpd.utinc.dev` のルート（`/`）に、事業者情報を載せた普通のランディングページを置く | 中 | 「ファイル配布しかない不審なホスト」に見えなくなる。**費用対効果が最も良い** |
| `noindex,nofollow` の見直し | 中 | 秘匿性とのトレードオフ。`/dl` は秘匿のまま、ルートだけインデックス許可にするのが現実的 |
| 配信リンクを別ホストに分離し、`lpd.utinc.dev` は管理画面専用にする | 大 | 遮断されても管理画面は生き残る。ただし遮断そのものは防げない |
| 実績のある独自ドメインへの移行 | 大 | 新しいドメインというリスク要因自体を消す。最終手段 |

---

## 5. やってはいけないこと

- **コードを直して復旧させようとする**。遮断は回線側で起きているのでデプロイでは直らない。
  2 回目の発生時、原因究明で最初にここを疑って時間を使った
- **接続エラー＝サーバー障害と決めつける**。DNS 遮断は接続エラーの見た目になる
- **運営者表記（`OPERATOR_FOOTER`）を消す**。`src/app/dl/[id]/route.ts` にコメント付きで置いてある
- **1 社だけ申請して終わりにする**。参照元は複数ある

---

## 6. 発生履歴

| 日付 | 事象 | 遮断元 | 対応 |
|---|---|---|---|
| 2026-08 | BrightCloud が誤分類 → 家庭用フィルタ（Plume 系）で `utinc.dev` が全面遮断 | BrightCloud | `/dl` のランディングと NotFound に運営者表記を常設（PR #43） |
| 2026-08-13 | `lpd.utinc.dev` に接続不可（接続エラー）。DNS・Vercel・Supabase はいずれも正常 | J:COM（Plume 系と推定） | 本ランブックを作成。**再分類の申請は未実施 — 次にやること** |

> 次に対応した人は、この表に追記してから作業を終えること。
