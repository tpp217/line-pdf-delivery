import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string; filename: string }> }

/**
 * /dl/{id}/view/{filename}
 *
 * PDF をブラウザ内で開く（Content-Disposition: inline）。
 * iOS Safari / LINE 内蔵ブラウザは「表示中の PDF を共有 → ファイルに保存」
 * したとき、Content-Disposition の filename を無視して URL パスの最終
 * セグメントから保存ファイル名を生成する挙動がある。そのため、URL に
 * 元ファイル名を含めて、保存時の名前が正しくなるようにする。
 *
 * 実際のPDF特定は id（UUID または short_code）でのみ行い、filename
 * パラメータは URL 表示用なのでサーバ側ではバリデーションのみ。
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
    return new Response('表示に失敗しました', { status: 500 })
  }

  const buffer = await fileData.arrayBuffer()
  const encoded = encodeURIComponent(pdf.originalFileName)

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      'Content-Length': buffer.byteLength.toString(),
      'Cache-Control': 'private, no-store',
    },
  })
}
