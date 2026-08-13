// 送信先（recipients）の自動登録ロジック。
//
// LINE webhook（受信イベント起点）と /api/v1/recipients/sync-group-members
// （画面からの手動一括取り込み）の双方から使う共通処理をここに集約する。
//
// 方針:
//   - 既存行の displayName は上書きしない（画面で付けた名前を自動処理が戻さない）
//   - 無効化されている行は再有効化する
//   - 失敗はログに残して握りつぶす（webhook を 200 で返し切るため）

import { supabase } from '@/lib/supabase'

const LINE_API_BASE = 'https://api.line.me/v2/bot'

/** グループ／ルームの別。LINE の source.type と同じ値。 */
export type GroupScope = 'group' | 'room'

export type RecipientType = 'user' | GroupScope

/** upsertRecipient の結果。呼び出し側の集計用。 */
export type UpsertOutcome = 'inserted' | 'reactivated' | 'exists' | 'failed'

function scopePath(scope: GroupScope, groupId: string): string {
  return scope === 'group' ? `group/${groupId}` : `room/${groupId}`
}

export async function nextSortOrder(tenantId: string): Promise<number> {
  const { data } = await supabase
    .from('recipients')
    .select('sortOrder')
    .eq('tenant_id', tenantId)
    .order('sortOrder', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.sortOrder ?? 0) + 1
}

export async function fetchGroupName(groupId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${LINE_API_BASE}/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return 'グループ'
    const summary = await res.json()
    return summary.groupName || 'グループ'
  } catch {
    return 'グループ'
  }
}

export async function fetchUserName(userId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${LINE_API_BASE}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return userId
    const profile = await res.json()
    return profile.displayName || userId
  } catch {
    return userId
  }
}

/**
 * グループ／ルームのメンバープロフィール。
 *
 * `/v2/bot/profile/{userId}` は「公式アカウントを友だち追加済み」のユーザーしか取れず、
 * グループに追加されただけの人は 404 になって表示名が userId のままになる。
 * メンバープロフィール API は友だち未追加でも取れるので、こちらを先に試す。
 */
export async function fetchGroupMemberName(
  scope: GroupScope,
  groupId: string,
  userId: string,
  token: string,
): Promise<string> {
  try {
    const res = await fetch(`${LINE_API_BASE}/${scopePath(scope, groupId)}/member/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const profile = await res.json()
      if (profile.displayName) return profile.displayName
    }
  } catch {
    // 握りつぶして下のフォールバックへ
  }
  // 友だち追加済みなら 1:1 のプロフィールで取れる。最後は userId のまま登録する。
  return fetchUserName(userId, token)
}

export class LineMemberIdsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'LineMemberIdsError'
  }
}

/**
 * グループ／ルームの現在のメンバー ID を全件取得する（continuation token でページング）。
 *
 * ★この API は「認証済みアカウント／プレミアムアカウント」限定。未認証アカウントだと
 *   403 が返る。呼び出し側が案内を出せるよう LineMemberIdsError(status) で投げる。
 */
export async function fetchGroupMemberIds(
  scope: GroupScope,
  groupId: string,
  token: string,
): Promise<string[]> {
  const ids: string[] = []
  let start: string | undefined
  // 1 回あたり最大 100 件。安全弁として 50 ページ（=5000人）で打ち切る。
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${LINE_API_BASE}/${scopePath(scope, groupId)}/members/ids`)
    if (start) url.searchParams.set('start', start)

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new LineMemberIdsError(
        body.message || `LINE API error: ${res.status}`,
        res.status,
      )
    }

    const data = await res.json()
    if (Array.isArray(data.memberIds)) ids.push(...data.memberIds)
    if (!data.next) return ids
    start = data.next
  }
  return ids
}

/**
 * recipients への登録（新規 insert / 無効化されていれば再有効化）。
 * 既存行の displayName は上書きしない。
 */
export async function upsertRecipient(opts: {
  tenantId: string
  lineUserId: string
  type: RecipientType
  resolveName: () => Promise<string>
  memo?: string
}): Promise<UpsertOutcome> {
  const { data: existing } = await supabase
    .from('recipients')
    .select('id, isActive')
    .eq('tenant_id', opts.tenantId)
    .eq('lineUserId', opts.lineUserId)
    .maybeSingle()

  if (existing) {
    if (existing.isActive) return 'exists'
    await supabase
      .from('recipients')
      .update({ isActive: true })
      .eq('tenant_id', opts.tenantId)
      .eq('id', existing.id)
    console.log(`[recipients] ${opts.type} reactivated: ${opts.lineUserId}`)
    return 'reactivated'
  }

  const displayName = await opts.resolveName()
  const { error } = await supabase.from('recipients').insert({
    tenant_id: opts.tenantId,
    lineUserId: opts.lineUserId,
    displayName,
    memo: opts.memo ?? null,
    isActive: true,
    isDefault: false,
    type: opts.type,
    sortOrder: await nextSortOrder(opts.tenantId),
  })
  if (error) {
    console.error(`[recipients] ${opts.type} insert failed (${opts.lineUserId}):`, error.message)
    return 'failed'
  }
  console.log(`[recipients] ${opts.type} registered: ${displayName} (${opts.lineUserId})`)
  return 'inserted'
}

export type SyncGroupMembersResult = {
  total: number
  inserted: number
  reactivated: number
  exists: number
  failed: number
}

/**
 * グループ／ルームの現在のメンバーを全員 recipients に取り込む。
 *
 * memberJoined（＝これから追加される人）では拾えない「すでに居るメンバー」を
 * 埋めるための処理。fetchGroupMemberIds が投げる例外はそのまま呼び出し側へ流す
 * （403＝未認証アカウントの案内を出し分けるため）。
 */
export async function syncGroupMembers(opts: {
  tenantId: string
  scope: GroupScope
  groupId: string
  groupName: string
  token: string
}): Promise<SyncGroupMembersResult> {
  const memberIds = await fetchGroupMemberIds(opts.scope, opts.groupId, opts.token)
  const result: SyncGroupMembersResult = {
    total: memberIds.length,
    inserted: 0,
    reactivated: 0,
    exists: 0,
    failed: 0,
  }

  for (const memberId of memberIds) {
    const outcome = await upsertRecipient({
      tenantId: opts.tenantId,
      lineUserId: memberId,
      type: 'user',
      resolveName: () => fetchGroupMemberName(opts.scope, opts.groupId, memberId, opts.token),
      memo: `「${opts.groupName}」のメンバーとして自動登録`,
    })
    result[outcome]++
  }

  return result
}
