import { DEFAULT_TENANT_ID } from '@/lib/tenant'
import {
  fetchGroupMemberName,
  fetchGroupName,
  fetchUserName,
  syncGroupMembers,
  upsertRecipient,
  type GroupScope,
} from '@/lib/recipients'
import { NextRequest, after } from 'next/server'
import crypto from 'crypto'

// テナント分離: LINE Webhook は JWT を持たず、現状チャネルは単一（utinc）。
// 受信ユーザー/グループの recipient 登録はすべて既定テナント(utinc)に閉じる。
// 将来テナント別チャネルにする場合は、署名検証に使う channel から tenant を引いて差し替える。
const WEBHOOK_TENANT_ID = DEFAULT_TENANT_ID

function verifySignature(body: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret) {
    // secret 未設定だと全リクエストを拒否してしまうため、無言ではなく明示的に警告する
    console.error('[webhook] LINE_CHANNEL_SECRET is not set; rejecting all webhook requests')
    return false
  }
  if (!signature) return false
  try {
    const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64')
    const a = Buffer.from(hash)
    const b = Buffer.from(signature)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// 業務フロー(workflow-system)へ postback イベントを転送する。
// LINE チャネルは workflow-system と共有しており、Webhook は当アプリが専有しているため、
// 当アプリでは扱わない postback（業務フローの承認操作など）だけを転送して肩代わりする。
// 設定（URL/シークレット）が無ければ何もしない＝当アプリ単体の動作は一切変わらない。
//
// 呼び出しは after() で「応答返却後」に実行する（fire-and-forget）。転送先(workflow)の
// 承認処理は DB/LINE API を叩いて時間がかかり、同期 await すると LINE への 200 応答が遅れ
// webhook タイムアウト → 再送 → 承認通知の氾濫を招くため。転送失敗はログのみ（catch 済み）。
async function forwardPostbackToWorkflow(event: {
  source?: { userId?: string }
  postback?: { data?: string }
  replyToken?: string
}): Promise<void> {
  const url = process.env.WORKFLOW_POSTBACK_URL
  const secret = process.env.WORKFLOW_FORWARD_SECRET
  if (!url || !secret) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-wf-forward-secret': secret },
      body: JSON.stringify({
        userId: event.source?.userId,
        data: event.postback?.data,
        replyToken: event.replyToken,
      }),
    })
  } catch (e) {
    console.error('[webhook] workflow postback forward failed:', e)
  }
}

// 公式アカウントがグループ／ルームに参加した直後に、そこに「すでに居る」メンバーを取り込む。
// memberJoined は参加の瞬間にしか飛ばないため、これが無いと参加前からのメンバーは
// 永久に登録されない。人数分の LINE API 呼び出しになり時間がかかるので after() で
// 応答返却後に回す（webhook タイムアウト → 再送を避ける）。
async function backfillGroupMembers(
  scope: GroupScope,
  groupId: string,
  resolveGroupName: () => Promise<string>,
  token: string,
): Promise<void> {
  const groupName = await resolveGroupName()
  try {
    const result = await syncGroupMembers({
      tenantId: WEBHOOK_TENANT_ID,
      scope,
      groupId,
      groupName,
      token,
    })
    console.log(
      `[webhook] join backfill: ${groupName} (${groupId}) total=${result.total} inserted=${result.inserted} reactivated=${result.reactivated}`,
    )
  } catch (e) {
    // メンバー一覧 API は認証済み／プレミアムアカウント限定（未認証だと 403）。
    // 取れなくても join 自体は成功させる（以降は memberJoined で1人ずつ増える）。
    console.error(`[webhook] join backfill failed (${groupId}):`, e)
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('x-line-signature')
  const secret = process.env.LINE_CHANNEL_SECRET

  if (!verifySignature(body, signature, secret)) {
    console.error('[webhook] Invalid signature')
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return Response.json({ ok: true })
  }

  const events = payload.events || []
  if (events.length === 0) {
    return Response.json({ ok: true })
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) {
    console.error('[webhook] LINE_CHANNEL_ACCESS_TOKEN is not set')
    return Response.json({ ok: true })
  }

  console.log(`[webhook] received ${events.length} event(s)`)

  for (const event of events) {
    // postback（業務フローの承認操作など）は当システムでは扱わず workflow-system へ転送する。
    // 従来 postback は実質無処理だったため、既存の recipient 登録フローには影響しない。
    if (event.type === 'postback') {
      // 応答をブロックしない（after で応答返却後に転送）。LINE へは即 200 を返し、
      // タイムアウト起因の webhook 再送を防ぐ。
      after(forwardPostbackToWorkflow(event))
      continue
    }

    const sourceType = event.source?.type
    const isGroupScope = sourceType === 'group' || sourceType === 'room'
    const groupId = event.source?.groupId || event.source?.roomId

    // グループ名は「新規 insert する時」と「join の一括取り込み」でしか要らない。
    // 発言のたびに LINE API を叩かないよう、実際に必要になった 1 回だけ解決する。
    let cachedGroupName: string | null = null
    const resolveGroupName = async (): Promise<string> => {
      if (cachedGroupName === null) {
        cachedGroupName =
          sourceType === 'group' && groupId ? await fetchGroupName(groupId, token) : 'ルーム'
      }
      return cachedGroupName
    }

    // メンバー参加（memberJoined）＝ 公式アカウントが居るグループ／ルームに人が追加された。
    // このイベントの source は group／room で `source.userId` を持たない（追加された本人は
    // joined.members[] 側に入る）。そのため下の「グループ由来」分岐に流すとグループ本体を
    // 見るだけで終わり、追加された人はどの分岐でも登録されないまま握りつぶされる。
    if (event.type === 'memberJoined') {
      if (!isGroupScope || !groupId) {
        console.log('[webhook] memberJoined without group/room id, skip')
        continue
      }

      // グループ本体も従来どおり登録／再有効化する（webhook 導入前から居るグループの取りこぼし対策）
      await upsertRecipient({
        tenantId: WEBHOOK_TENANT_ID,
        lineUserId: groupId,
        type: sourceType,
        resolveName: resolveGroupName,
      })

      const members: { userId?: string }[] = event.joined?.members || []
      console.log(`[webhook] memberJoined: ${members.length} member(s) in ${groupId}`)
      for (const member of members) {
        const memberId = member?.userId
        if (!memberId) continue
        await upsertRecipient({
          tenantId: WEBHOOK_TENANT_ID,
          lineUserId: memberId,
          type: 'user',
          resolveName: () => fetchGroupMemberName(sourceType, groupId, memberId, token),
          memo: `「${await resolveGroupName()}」への参加を検知して自動登録`,
        })
      }
      continue
    }

    // グループ／ルーム由来のイベント（join含む）
    if (isGroupScope) {
      if (!groupId) {
        console.log('[webhook] group event without id, skip')
        continue
      }

      await upsertRecipient({
        tenantId: WEBHOOK_TENANT_ID,
        lineUserId: groupId,
        type: sourceType,
        resolveName: resolveGroupName,
      })

      // 公式アカウントが新しくグループに参加したときだけ、既存メンバーを一括取り込みする。
      // （発言などの通常イベントで毎回やるとメンバー数ぶんの API を叩いてしまうため join 限定）
      if (event.type === 'join') {
        after(backfillGroupMembers(sourceType, groupId, resolveGroupName, token))
      }

      // グループ由来の通常イベント（発言など）では、発言者個人は recipient に追加しない。
      // 個人が増える起点は memberJoined と join 時の一括取り込みだけに限定する。
      continue
    }

    // 個人ユーザー由来のイベント（follow / message ほか）
    const userId = event.source?.userId
    if (!userId) {
      console.log('[webhook] event without userId, skip')
      continue
    }

    await upsertRecipient({
      tenantId: WEBHOOK_TENANT_ID,
      lineUserId: userId,
      type: 'user',
      resolveName: () => fetchUserName(userId, token),
    })
  }

  return Response.json({ ok: true })
}
