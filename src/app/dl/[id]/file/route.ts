import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

/**
 * /dl/{id}/file
 * ランディングページ (/dl/{id}) の「ダウンロード」ボタンから飛ぶ実ファイル配信。
 * id は UUID（pdf_documents.id）または短縮コード（short_code）を受け付ける。
 */
export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params

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
  const asciiFallback =
    pdf.originalFileName.replace(/[^\x20-\x7E]+/g, '_') || 'download'
  const encoded = encodeURIComponent(pdf.originalFileName)

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition':
        `attachment; filename="${asciiFallback.replace(/"/g, '')}"; ` +
        `filename*=UTF-8''${encoded}`,
      'Content-Length': buffer.byteLength.toString(),
      'Cache-Control': 'private, no-store',
    },
  })
}
