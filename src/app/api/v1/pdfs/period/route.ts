import { supabase } from '@/lib/supabase'
import { isValidUploadPeriod } from '@/lib/upload-period'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

/**
 * 「〇月アップ分」タグの付け替え。
 *
 * 実際のアップロード日時は既定値を出すためだけに使うので、選び間違えたり
 * 過去分の差し替えを普通に上げてしまった場合に、あとから直せる必要がある。
 *
 * PATCH body: { ids: string[], uploadPeriod: 'YYYY-MM' }
 */
export async function PATCH(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const body = await request.json().catch(() => ({}))

  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v: unknown) => typeof v === 'string')
    : []
  if (ids.length === 0) {
    return Response.json({ error: 'ids は必須です' }, { status: 400 })
  }

  const uploadPeriod = body?.uploadPeriod
  if (!isValidUploadPeriod(uploadPeriod)) {
    return Response.json(
      { error: 'uploadPeriod は YYYY-MM 形式で指定してください' },
      { status: 400 },
    )
  }

  // tenant_id で絞るので、他テナントの書類は対象にならない（件数にも出ない）。
  const { data, error } = await supabase
    .from('pdf_documents')
    .update({ upload_period: uploadPeriod })
    .eq('tenant_id', tenantId)
    .is('deletedAt', null)
    .in('id', ids)
    .select('id')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ updated: (data ?? []).length, uploadPeriod })
}
