import { supabase } from '@/lib/supabase'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import {
  LineMemberIdsError,
  syncGroupMembers,
  type GroupScope,
} from '@/lib/recipients'
import { NextRequest } from 'next/server'

/**
 * グループの現在のメンバーを送信先として一括取り込みする。
 *
 * webhook の memberJoined は「これから追加される人」にしか発火しないため、
 * すでにグループに居るメンバーはこの手動同期でしか取り込めない。
 *
 * Body: { recipientId?: string }
 *   - 指定あり: そのグループ／ルームだけ同期
 *   - 指定なし: 有効なグループ／ルーム全件を同期
 *
 * ★LINE のメンバー一覧 API は認証済み／プレミアムアカウント限定。
 *   未認証アカウントだと 403 が返るため、その旨を呼び出し元に伝える。
 *
 * 認証は proxy.ts のゲート（wh JWT + capability lpd.write）が担う。
 */
export async function POST(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) {
    return Response.json(
      { error: 'LINE_CHANNEL_ACCESS_TOKEN が未設定です' },
      { status: 500 },
    )
  }

  const body = await request.json().catch(() => null)
  const recipientId = typeof body?.recipientId === 'string' ? body.recipientId : null

  let query = supabase
    .from('recipients')
    .select('id, displayName, lineUserId, type')
    .eq('tenant_id', tenantId)
    .in('type', ['group', 'room'])
    .eq('isActive', true)
    .order('sortOrder', { ascending: true })

  if (recipientId) query = query.eq('id', recipientId)

  const { data: groups, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!groups || groups.length === 0) {
    return Response.json(
      { error: '対象のグループが見つかりません' },
      { status: 404 },
    )
  }

  const results = []
  let inserted = 0
  let reactivated = 0
  // 1件でも「認証済みアカウント限定」で弾かれたら、全体の案内としてこれを返す。
  let forbidden = false

  for (const group of groups) {
    try {
      const result = await syncGroupMembers({
        tenantId,
        scope: group.type as GroupScope,
        groupId: group.lineUserId,
        groupName: group.displayName,
        token,
      })
      inserted += result.inserted
      reactivated += result.reactivated
      results.push({ id: group.id, displayName: group.displayName, ...result })
    } catch (e) {
      const status = e instanceof LineMemberIdsError ? e.status : 0
      if (status === 403) forbidden = true
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[sync-group-members] failed (${group.lineUserId}):`, message)
      results.push({
        id: group.id,
        displayName: group.displayName,
        error: message,
        status,
      })
    }
  }

  return Response.json({
    ok: true,
    inserted,
    reactivated,
    groups: results,
    // 未認証アカウントで API 自体が使えないケースは、画面で案内を出し分けたいので明示する。
    forbidden,
    ...(forbidden
      ? {
          notice:
            'メンバー一覧の取得が LINE 側で拒否されました（403）。この API は認証済みアカウント／プレミアムアカウント限定です。',
        }
      : {}),
  })
}
