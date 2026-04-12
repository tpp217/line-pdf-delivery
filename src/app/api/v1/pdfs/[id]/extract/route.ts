import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const { data: doc, error: fetchErr } = await supabase
    .from('pdf_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 })
  if (!doc) return Response.json({ error: 'PDFが見つかりません' }, { status: 404 })

  await supabase
    .from('pdf_documents')
    .update({ extractStatus: 'PROCESSING' })
    .eq('id', id)

  try {
    const { data: fileData, error: dlErr } = await supabase.storage
      .from(doc.storageBucket)
      .download(doc.storagePath)

    if (dlErr || !fileData) {
      await supabase
        .from('pdf_documents')
        .update({ extractStatus: 'FAILED' })
        .eq('id', id)
      return Response.json({ error: dlErr?.message || 'ダウンロード失敗' }, { status: 500 })
    }

    const arrayBuffer = await fileData.arrayBuffer()
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) })
    const textResult = await parser.getText()
    const infoResult = await parser.getInfo()
    await parser.destroy()

    const text = textResult.text || ''
    const pageCount = textResult.total || null
    const { companyName, personName } = extractNames(text)

    const { data: updated } = await supabase
      .from('pdf_documents')
      .update({
        extractedText: text,
        extractStatus: 'DONE',
        pageCount,
        companyName,
        personName,
        extractionConfidence: companyName ? 80 : 0,
      })
      .eq('id', id)
      .select()
      .single()

    return Response.json({
      id,
      extractStatus: 'DONE',
      companyName,
      personName,
      pageCount,
      title: infoResult?.info?.Title || null,
      ...(updated || {}),
    })
  } catch (e) {
    await supabase
      .from('pdf_documents')
      .update({ extractStatus: 'FAILED' })
      .eq('id', id)
    return Response.json(
      { error: e instanceof Error ? e.message : 'テキスト抽出に失敗しました' },
      { status: 500 },
    )
  }
}

function extractNames(text: string): { companyName: string | null; personName: string | null } {
  let companyName: string | null = null
  let personName: string | null = null

  const corpPatterns = [
    /(?:株式会社|有限会社|合同会社|一般社団法人|特定非営利活動法人)\s*[\p{L}\p{N}ー・\s]{1,40}/u,
    /[\p{L}\p{N}ー・\s]{1,40}(?:株式会社|有限会社|合同会社)/u,
  ]
  for (const pattern of corpPatterns) {
    const match = text.match(pattern)
    if (match) {
      companyName = match[0].trim()
      break
    }
  }

  const namePatterns = [
    /(?:代表取締役|代表者|担当者|氏名|名前)[：:\s]*([^\s\n]{2,10})/u,
    /(?:殿|様|御中)[\s\n].*?([^\s\n]{2,10})\s*(?:殿|様)/u,
  ]
  for (const pattern of namePatterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      personName = match[1].trim()
      break
    }
  }

  return { companyName, personName }
}
