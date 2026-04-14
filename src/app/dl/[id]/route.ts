import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params

  // UUID形式なら id、それ以外は short_code で検索（後方互換）
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

  const { data: pdf } = await supabase
    .from('pdf_documents')
    .select('storageBucket, storagePath, originalFileName')
    .eq(isUuid ? 'id' : 'short_code', id)
    .is('deletedAt', null)
    .maybeSingle()

  if (!pdf) {
    return new Response('Not Found', { status: 404 })
  }

  const { data: fileData, error } = await supabase.storage
    .from(pdf.storageBucket)
    .download(pdf.storagePath)

  if (error || !fileData) {
    return new Response('ダウンロード失敗', { status: 500 })
  }

  const buffer = await fileData.arrayBuffer()
  const encodedName = encodeURIComponent(pdf.originalFileName)

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
      'Content-Length': buffer.byteLength.toString(),
    },
  })
}
