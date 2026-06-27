import { supabase } from '@/lib/supabase'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { NextRequest } from 'next/server'

/**
 * 送信履歴一覧API
 *
 * Query:
 *   recipientId?: string
 *   status?: 'SENT' | 'FAILED' | 'PENDING' | 'PROCESSING' | 'CANCELLED'
 *   from?: ISO8601 (createdAt >=)
 *   to?:   ISO8601 (createdAt <=)
 *   limit?: number (default 100, max 500)
 *   offset?: number (default 0)
 *
 * Returns:
 *   {
 *     items: [{
 *       id, createdAt, sentAt, status,
 *       kind: 'PDF' | 'TEXT',
 *       recipient: { id, displayName },
 *       pdfFileName: string | null,
 *       messageTitle: string | null,
 *       messageBody: string | null,
 *       errorMessage: string | null,
 *     }],
 *     total: number
 *   }
 */
export async function GET(request: NextRequest) {
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

  const sp = request.nextUrl.searchParams
  const recipientId = sp.get('recipientId')
  const status = sp.get('status')
  const from = sp.get('from')
  const to = sp.get('to')
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '100', 10) || 100, 1), 500)
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0)

  let q = supabase
    .from('send_jobs')
    .select(
      `id, createdAt, sentAt, status, messageTitle, messageBody, errorMessage, pdfDocumentId,
       recipient:recipients(id, displayName),
       pdf:pdf_documents(originalFileName, personName)`,
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .order('createdAt', { ascending: false })
    .range(offset, offset + limit - 1)

  if (recipientId) q = q.eq('recipientId', recipientId)
  if (status) q = q.eq('status', status)
  if (from) q = q.gte('createdAt', from)
  if (to) q = q.lte('createdAt', to)

  const { data, error, count } = await q
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  type Row = {
    id: string
    createdAt: string
    sentAt: string | null
    status: string
    messageTitle: string | null
    messageBody: string | null
    errorMessage: string | null
    pdfDocumentId: string | null
    recipient: { id: string; displayName: string } | null
    pdf: { originalFileName: string; personName: string | null } | null
  }

  const items = (data as unknown as Row[] | null ?? []).map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    status: row.status,
    kind: row.pdfDocumentId ? 'PDF' : 'TEXT',
    recipient: row.recipient,
    pdfFileName: row.pdf?.personName || row.pdf?.originalFileName || null,
    messageTitle: row.messageTitle,
    messageBody: row.messageBody,
    errorMessage: row.errorMessage,
  }))

  return Response.json({ items, total: count ?? items.length })
}
