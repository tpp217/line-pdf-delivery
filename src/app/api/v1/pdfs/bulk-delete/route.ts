import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { ids } = body as { ids: string[] }

  if (!ids || ids.length === 0) {
    return Response.json({ error: '削除対象が指定されていません' }, { status: 400 })
  }

  const { data: docs } = await supabase
    .from('pdf_documents')
    .select('id, storageBucket, storagePath')
    .in('id', ids)

  if (docs && docs.length > 0) {
    const paths = docs.map((d) => d.storagePath)
    await supabase.storage.from(docs[0].storageBucket).remove(paths)
  }

  const { error } = await supabase
    .from('pdf_documents')
    .update({ deletedAt: new Date().toISOString() })
    .in('id', ids)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ deleted: ids.length })
}
