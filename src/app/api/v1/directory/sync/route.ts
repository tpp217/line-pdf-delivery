import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'
import crypto from 'node:crypto'

// workspace-hub のロスターAPI からメンバー名簿を取得し member_directory に同期する。
// 認証: Authorization: Bearer <SSO_EXCHANGE_SECRET>（サーバー間。ロスターAPI と同じ秘密で保護）。
// トリガは運用者 or cron（このアプリのフロントには名簿管理UIが無いため、ボタンではなくエンドポイント方式）。
// 名簿は将来の担当アサイン等の候補リスト（ログイン未済の人も含む組織名簿）として使う。

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export async function POST(request: NextRequest) {
  const secret = (process.env.SSO_EXCHANGE_SECRET ?? '').trim()
  if (!secret) return Response.json({ ok: false, error: 'SSO_EXCHANGE_SECRET 未設定' }, { status: 500 })

  const authz = request.headers.get('authorization') ?? ''
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!token || !safeEq(token, secret)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const tenantId = (request.nextUrl.searchParams.get('tenant_id') ?? '').trim()
  if (!tenantId) return Response.json({ ok: false, error: 'tenant_id は必須です' }, { status: 400 })

  const systemKey = (process.env.AUTH_SYSTEM_KEY ?? 'lpd').trim()

  // --- ロスターをプル ---
  const rosterUrl = `https://auth.utinc.dev/api/roster?tenant_id=${encodeURIComponent(tenantId)}&system_key=${encodeURIComponent(systemKey)}`
  const rosterRes = await fetch(rosterUrl, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: 'no-store',
  })
  if (!rosterRes.ok) {
    return Response.json({ ok: false, error: `roster API ${rosterRes.status}` }, { status: 502 })
  }
  const roster = await rosterRes.json()
  const members: Array<Record<string, unknown>> = Array.isArray(roster?.members) ? roster.members : []

  // --- service_role で同期（RLS 貫通）。名簿から消えた人は active=false ---
  await supabase
    .from('member_directory')
    .update({ active: false })
    .eq('system_key', systemKey)
    .eq('tenant_id', tenantId)

  if (members.length > 0) {
    const now = new Date().toISOString()
    const rows = members.map((m) => ({
      system_key: systemKey,
      tenant_id: tenantId,
      member_id: String(m.id),
      kind: (m.kind as string) ?? null,
      display_name: (m.display_name as string) ?? '',
      department: (m.department as string) ?? null,
      line_user_id: (m.line_user_id as string) ?? null,
      active: true,
      source_updated_at: (m.updated_at as string) ?? null,
      synced_at: now,
    }))
    const { error } = await supabase
      .from('member_directory')
      .upsert(rows, { onConflict: 'system_key,tenant_id,member_id' })
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, count: members.length })
}
