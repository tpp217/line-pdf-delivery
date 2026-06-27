import { supabase } from '@/lib/supabase'
import { sanitizeLikePattern } from '@/lib/postgrest'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  // テナント分離: 呼び出し元の tenant_id 配下のみを返す（解決不能なら fail-closed）。
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '20')
  const extractStatus = searchParams.get('extractStatus')
  const companyName = searchParams.get('companyName')
  const keyword = searchParams.get('keyword')

  let query = supabase
    .from('pdf_documents')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .is('deletedAt', null)
    .order('uploadedAt', { ascending: false })

  if (extractStatus) query = query.eq('extractStatus', extractStatus)
  if (companyName) {
    // ユーザー入力を ilike パターンとして安全化（フィルタインジェクション対策）
    const safe = sanitizeLikePattern(companyName)
    if (safe) query = query.ilike('companyName', `%${safe}%`)
  }
  if (keyword) {
    // .or() はフィルタ文字列を素で組み立てるため必ずサニタイズする
    const safe = sanitizeLikePattern(keyword)
    if (safe) {
      query = query.or(
        `originalFileName.ilike.%${safe}%,companyName.ilike.%${safe}%,personName.ilike.%${safe}%`,
      )
    }
  }

  const from = (page - 1) * pageSize
  query = query.range(from, from + pageSize - 1)

  const { data, error, count } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({
    items: data,
    total: count ?? 0,
    page,
    pageSize,
  })
}
