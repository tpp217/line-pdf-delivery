// ============================================================
// GET /api/whoami — ログインユーザーの claims（自分の情報のみ）を返す
//
// 用途:
//   - フロントの identity 表示（ヘッダのテナント名・氏名・部署）。
//   - is_demo（デモ/テスト用テナントか）でモック/初期状態の出し分けに使う。
//
// 認証: getRequestClaims（Authorization: Bearer / wh_token cookie）。
//   未認証は 401。返すのは「呼び出した本人の claims」のみ（他人の情報は出さない）。
//   capabilities は内訳を出さず件数のみ（過剰露出を避ける）。
//   ブラウザのアドレスバーから直接開けるよう同一オリジン制限は掛けない
//   （返すのは本人の情報だけで、トークンが無ければ 401 になるため）。
// ============================================================
import { NextRequest, NextResponse } from 'next/server'
import { getRequestClaims } from '@/lib/auth-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const claims = await getRequestClaims(req)
  if (!claims) {
    return NextResponse.json(
      { ok: false, error: '未認証です（ログインしてから開いてください）' },
      { status: 401 },
    )
  }
  return NextResponse.json({
    ok: true,
    sub: claims.sub ?? null,
    line_user_id: claims.line_user_id ?? null,
    tenant_id: claims.tenant_id ?? null,
    level: claims.level ?? null,
    systems: claims.systems,
    capabilities_count: claims.capabilities.length,
    // デモ/テスト用テナントなら true（未付与は false）。フロントがモック/初期状態の出し分けに使う。
    is_demo: claims.is_demo ?? false,
    // 表示用: 氏名 / テナント名 / 主所属部署名（いずれも未付与なら null）。
    name: claims.name ?? null,
    tenant_name: claims.tenant_name ?? null,
    department: claims.department ?? null,
    // 選択中（または home）の部署 ID（UUID・未付与なら null）。部署既定フィルタの基準用に
    // 受け渡すが、業務データに department 次元が無いため現状フィルタには未使用。
    department_id: claims.department_id ?? null,
  })
}
