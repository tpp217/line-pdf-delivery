import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '20')
  const extractStatus = searchParams.get('extractStatus')
  const companyName = searchParams.get('companyName')
  const keyword = searchParams.get('keyword')

  let query = supabase
    .from('pdf_documents')
    .select('*', { count: 'exact' })
    .is('deletedAt', null)
    .order('uploadedAt', { ascending: false })

  if (extractStatus) query = query.eq('extractStatus', extractStatus)
  if (companyName) query = query.ilike('companyName', `%${companyName}%`)
  if (keyword) {
    query = query.or(
      `originalFileName.ilike.%${keyword}%,companyName.ilike.%${keyword}%,personName.ilike.%${keyword}%`,
    )
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
