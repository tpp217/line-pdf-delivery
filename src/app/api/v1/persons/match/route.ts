import { buildCandidateGroups, loadMatchIndex } from '@/lib/person-match'
import { applyMatchActions, type MatchAction } from '@/lib/person-merge'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

/**
 * 人物の「要確認」候補と、その確定（同一人物 / 別人）。
 *
 * 取り込み側（uploads/folder）は正規化キーの完全一致でしか既存人物へ寄せない。
 * 「奥村」と「奥村華月」、「奥村華月」と「奥山華月」のように同一人物か別人か
 * 機械には決められないものは、ここで候補として出して人が確定する。
 * 確定結果は person_aliases（同一人物）／person_match_dismissals（別人）に残り、
 * 次回以降のアップロードへ自動で効く。
 */

/** 1 リクエストで受け付ける指示の上限。画面の一括確定でも十分な数。 */
const MAX_ACTIONS = 200

/** GET: { items: [{ person, candidates: [{ person, reason, score }] }] } */
export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const index = await loadMatchIndex(tenantId)
  return Response.json({ items: buildCandidateGroups(index) })
}

function parseAction(raw: unknown): MatchAction | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const action = r.action
  const sourceId = r.sourceId
  const targetId = r.targetId
  if (action !== 'merge' && action !== 'separate') return null
  if (typeof sourceId !== 'string' || !sourceId) return null
  if (typeof targetId !== 'string' || !targetId) return null
  if (sourceId === targetId) return null
  return { action, sourceId, targetId }
}

/**
 * POST: 単発でも一括でも受け付ける。
 *
 *   単発: { action: 'merge' | 'separate', sourceId, targetId }
 *   一括: { actions: [{ action, sourceId, targetId }, ...] }
 *
 *   merge    … sourceId を targetId に統合する（source は削除される）
 *   separate … 別人として確定し、以後この組を候補に出さない
 *
 * 「保留」はサーバー側の状態を持たない（＝何もしない）。次回もそのまま候補に出る。
 */
export async function POST(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const body = await request.json().catch(() => ({}))

  const rawActions = Array.isArray(body?.actions) ? body.actions : [body]
  if (rawActions.length === 0) {
    return Response.json({ error: '確定する指示がありません' }, { status: 400 })
  }
  if (rawActions.length > MAX_ACTIONS) {
    return Response.json(
      { error: `一度に確定できるのは ${MAX_ACTIONS} 件までです` },
      { status: 400 },
    )
  }

  const actions: MatchAction[] = []
  for (const raw of rawActions) {
    const parsed = parseAction(raw)
    if (!parsed) {
      return Response.json(
        {
          error:
            "指示の形式が不正です（action は 'merge' または 'separate'、sourceId と targetId は別の人物のIDが必要です）",
        },
        { status: 400 },
      )
    }
    actions.push(parsed)
  }

  const results = await applyMatchActions(tenantId, actions)

  const summary = {
    merged: results.filter((r) => r.status === 'merged').length,
    separated: results.filter((r) => r.status === 'separated').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
  }

  // 1 件でも失敗があれば 207 を返し、画面がどれが残ったか出せるようにする。
  return Response.json({ ...summary, results }, { status: summary.failed > 0 ? 207 : 200 })
}
