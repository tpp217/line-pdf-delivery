import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const files = formData.getAll('files') as File[]
  const sourceFolderName = formData.get('sourceFolderName') as string | null

  const pdfFiles = files.filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
  )

  if (pdfFiles.length === 0) {
    return Response.json({ error: 'PDFファイルが含まれていません' }, { status: 400 })
  }

  const { data: batch, error: batchErr } = await supabase
    .from('pdf_upload_batches')
    .insert({
      batchName: sourceFolderName || `アップロード ${new Date().toLocaleString('ja-JP')}`,
      sourceFolderName: sourceFolderName || null,
      totalFiles: files.length,
      totalPdfFiles: pdfFiles.length,
    })
    .select()
    .single()

  if (batchErr) return Response.json({ error: batchErr.message }, { status: 500 })

  const documentIds: string[] = []

  for (const file of pdfFiles) {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const storagePath = `${batch.id}/${file.name}`

    const { error: uploadErr } = await supabase.storage
      .from('pdfs')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadErr) {
      console.error(`Upload failed: ${file.name}`, uploadErr.message)
      continue
    }

    const { data: doc, error: docErr } = await supabase
      .from('pdf_documents')
      .insert({
        uploadBatchId: batch.id,
        originalFileName: file.name,
        storageBucket: 'pdfs',
        storagePath,
        fileSizeBytes: file.size,
        extractStatus: 'PENDING',
      })
      .select('id')
      .single()

    if (!docErr && doc) documentIds.push(doc.id)
  }

  return Response.json(
    {
      uploadBatchId: batch.id,
      acceptedFiles: documentIds.length,
      ignoredFiles: files.length - pdfFiles.length,
      documentIds,
    },
    { status: 201 },
  )
}
