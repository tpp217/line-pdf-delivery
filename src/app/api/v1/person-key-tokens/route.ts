import { supabase } from '@/lib/supabase'
import { DEFAULT_DOC_TOKENS } from '@/lib/person-key'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

/**
 * 書類名トークン辞書（ファイル名から落とす語）。
 *
 * クライアントごとにファイル名の付け方が違うため、
 * 「給与支払明細書」「〇〇株式会社」のような語を画面から足せるようにする。
 * 既定語（DEFAULT_DOC_TOKENS）はコード側に持ち、この表の内容と合成して使う。
 */

const MAX_TOKEN_LENGTH = 60

/** GET: { tokens: string[], defaults: string[] } */
export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { data, error } = await supabase
    .from('person_key_tokens')
    .select('token')
    .eq('tenant_id', tenantId)
    .order('token', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({
    tokens: (data ?? []).map((r) => (r as { token: string }).token),
    defaults: DEFAULT_DOC_TOKENS,
  })
}

/** POST: { token: string } — 既にあれば何もしない（冪等） */
export async function POST(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const body = await request.json().catch(() => ({}))
  const token = typeof body?.token === 'string' ? body.token.trim() : ''

  if (!token) {
    return Response.json({ error: 'token は必須です' }, { status: 400 })
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return Response.json(
      { error: `token が長すぎます（${MAX_TOKEN_LENGTH}文字まで）` },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('person_key_tokens')
    .upsert(
      { tenant_id: tenantId, token },
      { onConflict: 'tenant_id,token', ignoreDuplicates: true },
    )

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ token }, { status: 201 })
}

/** DELETE: ?token=... */
export async function DELETE(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const token = request.nextUrl.searchParams.get('token')
  if (!token) return Response.json({ error: 'token は必須です' }, { status: 400 })

  const { error } = await supabase
    .from('person_key_tokens')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('token', token)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
