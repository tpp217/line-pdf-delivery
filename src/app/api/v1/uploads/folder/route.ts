import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import JSZip from 'jszip'

type PdfEntry = { name: string; data: Buffer; size: number }

async function extractPdfsFromZip(zipData: ArrayBuffer | Buffer, pdfs: PdfEntry[]): Promise<number> {
  const zip = await JSZip.loadAsync(zipData)
  let count = 0

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const lower = entry.name.toLowerCase()

    if (lower.endsWith('.pdf')) {
      const buf = await entry.async('nodebuffer')
      const fileName = entry.name.split('/').pop() || entry.name
      pdfs.push({ name: fileName, data: buf, size: buf.length })
      count++
    } else if (lower.endsWith('.zip')) {
      const nested = await entry.async('arraybuffer')
      count += await extractPdfsFromZip(nested, pdfs)
    }
  }

  return count
}

async function extractPdfsFromFiles(files: File[]): Promise<{ pdfs: PdfEntry[]; totalFiles: number }> {
  const pdfs: PdfEntry[] = []
  let totalFiles = 0

  for (const file of files) {
    const isZip =
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed' ||
      file.name.toLowerCase().endsWith('.zip')

    if (isZip) {
      const count = await extractPdfsFromZip(await file.arrayBuffer(), pdfs)
      totalFiles += count
    } else if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      const buf = Buffer.from(await file.arrayBuffer())
      pdfs.push({ name: file.name, data: buf, size: file.size })
      totalFiles++
    } else {
      totalFiles++
    }
  }

  return { pdfs, totalFiles }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const files = formData.getAll('files') as File[]
  const sourceFolderName = formData.get('sourceFolderName') as string | null

  const { pdfs, totalFiles } = await extractPdfsFromFiles(files)

  if (pdfs.length === 0) {
    return Response.json({ error: 'PDFファイルが含まれていません（ZIPの中身も確認済み）' }, { status: 400 })
  }

  const { data: batch, error: batchErr } = await supabase
    .from('pdf_upload_batches')
    .insert({
      batchName: sourceFolderName || `アップロード ${new Date().toLocaleString('ja-JP')}`,
      sourceFolderName: sourceFolderName || null,
      totalFiles,
      totalPdfFiles: pdfs.length,
    })
    .select()
    .single()

  if (batchErr) return Response.json({ error: batchErr.message }, { status: 500 })

  const documentIds: string[] = []

  for (const pdf of pdfs) {
    const storagePath = `${batch.id}/${randomUUID()}.pdf`

    const { error: uploadErr } = await supabase.storage
      .from('pdfs')
      .upload(storagePath, pdf.data, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadErr) {
      console.error(`Upload failed: ${pdf.name}`, uploadErr.message)
      continue
    }

    const personName = pdf.name.replace(/\.pdf$/i, '')

    const { data: person } = await supabase
      .from('persons')
      .upsert({ name: personName }, { onConflict: 'name' })
      .select('id')
      .single()

    const { data: doc, error: docErr } = await supabase
      .from('pdf_documents')
      .insert({
        uploadBatchId: batch.id,
        originalFileName: pdf.name,
        storageBucket: 'pdfs',
        storagePath,
        fileSizeBytes: pdf.size,
        extractStatus: 'DONE',
        personName,
        personId: person?.id || null,
      })
      .select('id')
      .single()

    if (!docErr && doc) documentIds.push(doc.id)
  }

  return Response.json(
    {
      uploadBatchId: batch.id,
      acceptedFiles: documentIds.length,
      ignoredFiles: totalFiles - pdfs.length,
      documentIds,
    },
    { status: 201 },
  )
}
