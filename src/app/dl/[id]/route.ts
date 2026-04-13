import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params

  const { data: pdf } = await supabase
    .from('pdf_documents')
    .select('storageBucket, storagePath, originalFileName')
    .eq('id', id)
    .is('deletedAt', null)
    .maybeSingle()

  if (!pdf) {
    return new Response('Not Found', { status: 404 })
  }

  const { data } = await supabase.storage
    .from(pdf.storageBucket)
    .createSignedUrl(pdf.storagePath, 60 * 60 * 72, {
      download: pdf.originalFileName,
    })

  if (!data?.signedUrl) {
    return new Response('URL生成失敗', { status: 500 })
  }

  return Response.redirect(data.signedUrl, 302)
}
