import { supabase } from '@/lib/supabase'
import { resolveTenantId, unauthenticatedTenant } from '@/lib/tenant'
import { loadMatchIndex, resolvePersonForFile, type ResolveOutcome } from '@/lib/person-match'
import { findDuplicate, loadDedupeIndex, registerUploaded, sha256 } from '@/lib/pdf-dedupe'
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
  const tenantId = await resolveTenantId(request)
  if (!tenantId) return unauthenticatedTenant()

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
      tenant_id: tenantId,
      batchName: sourceFolderName || `アップロード ${new Date().toLocaleString('ja-JP')}`,
      sourceFolderName: sourceFolderName || null,
      totalFiles,
      totalPdfFiles: pdfs.length,
    })
    .select()
    .single()

  if (batchErr) return Response.json({ error: batchErr.message }, { status: 500 })

  const documentIds: string[] = []

  // 人物の解決に使う索引（既存人物・エイリアス・却下ペア・書類名辞書）を
  // バッチの先頭で 1 回だけ読む。ループ内で新規作成した人物も index に入るので、
  // 同じバッチに同一人物のファイルが複数あっても 1 人にまとまる。
  const matchIndex = await loadMatchIndex(tenantId)
  const matched: Record<ResolveOutcome, number> = { alias: 0, key: 0, created: 0 }

  // 同じ PDF の二重登録を防ぐための索引。ファイル名では判定できない
  // （年月がファイル名に入らないので 9月分と 10月分が同名になる）ため、
  // 中身の SHA-256 で判定する。
  const dedupeIndex = await loadDedupeIndex(tenantId)
  let skippedDuplicates = 0

  for (const pdf of pdfs) {
    // 重複判定はストレージへ上げる前に行う。後で弾くと実体だけが残ってゴミになる。
    const contentHash = sha256(pdf.data)
    const duplicate = await findDuplicate(dedupeIndex, {
      name: pdf.name,
      size: pdf.size,
      hash: contentHash,
    })
    if (duplicate) {
      skippedDuplicates++
      console.log(`[uploads] 登録済みのためスキップ: ${pdf.name} (既存 ${duplicate.id})`)
      continue
    }

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

    // ファイル名 → 人物。エイリアス → 正規化キー完全一致 → 新規作成 の順。
    // あいまい一致でここが既存人物へ寄ることはない（誤配信を出さないため）。
    // 似た人物がいる場合は画面の「要確認」に候補として出る。
    const resolved = await resolvePersonForFile(matchIndex, pdf.name)
    const personName = resolved.personName
    matched[resolved.outcome]++

    const { data: doc, error: docErr } = await supabase
      .from('pdf_documents')
      .insert({
        tenant_id: tenantId,
        uploadBatchId: batch.id,
        originalFileName: pdf.name,
        storageBucket: 'pdfs',
        storagePath,
        fileSizeBytes: pdf.size,
        extractStatus: 'DONE',
        personName,
        personId: resolved.personId,
        content_hash: contentHash,
      })
      .select('id')
      .single()

    if (!docErr && doc) {
      documentIds.push(doc.id)
      // 同じバッチ内に同一ファイルが 2 つある場合に 2 件目を弾けるようにする。
      registerUploaded(dedupeIndex, {
        id: doc.id,
        originalFileName: pdf.name,
        fileSizeBytes: pdf.size,
        storageBucket: 'pdfs',
        storagePath,
        contentHash,
      })
    }
  }

  // 全件が重複だったときにバッチだけが残ると、履歴に空の行が溜まっていく。
  // どの書類からも参照されていないので消してよい。
  if (documentIds.length === 0) {
    await supabase
      .from('pdf_upload_batches')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', batch.id)
  }

  return Response.json(
    {
      uploadBatchId: documentIds.length > 0 ? batch.id : null,
      acceptedFiles: documentIds.length,
      ignoredFiles: totalFiles - pdfs.length,
      documentIds,
      // 内訳。画面は newPersons > 0 のときに「要確認」へ誘導する。
      matchedByAlias: matched.alias,
      matchedByName: matched.key,
      newPersons: matched.created,
      // 中身が既存の書類と同一だったため登録しなかった件数。
      skippedDuplicates,
    },
    { status: 201 },
  )
}
