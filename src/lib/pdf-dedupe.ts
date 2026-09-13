// 同じ PDF の二重登録を防ぐ判定。
//
// アップロードはバッチごとに新しい storagePath を作って insert するため、
// 同じファイルを上げ直すと上書きではなく行が増える。カテゴリで絞って一括送信すると
// 同じ人に同じ PDF が 2 通届くので、取り込みの時点で弾く。
//
// 判定は PDF の中身の SHA-256 で行う。ファイル名では判定できない
// （運用上ファイル名に年月が入らないため、ある人の 9月分と 10月分が同名になる。
//  「同名だから重複」とすると翌月の給与明細を取りこぼす）。
//
// 既存行にはハッシュが無いので、新規ファイルと「同名かつ同サイズ」の既存行が
// あったときだけ、その数件をストレージから読んでハッシュを計算し列に保存する。
// 一括バックフィルを人手で走らせる必要がなく、触れた行から厳密判定へ移っていく。
//
// 安全側の原則: ハッシュを確定できなかった行は「重複ではない」として扱う。
// 取りこぼし（本物の書類を黙って捨てる）より、重複を 1 件通すほうが害が小さい。

import { createHash } from 'crypto'
import { supabase } from '@/lib/supabase'

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export type DedupeRow = {
  id: string
  originalFileName: string
  fileSizeBytes: number
  storageBucket: string
  storagePath: string
  contentHash: string | null
}

export type DedupeIndex = {
  tenantId: string
  /** 確定済みハッシュ → 既存の書類 */
  byHash: Map<string, DedupeRow>
  /** ハッシュ未計算の既存行を「サイズ|ファイル名」で引く（遅延ハッシュの候補） */
  legacyByNameSize: Map<string, DedupeRow[]>
}

// サイズを先頭に置くので、ファイル名に区切り文字が含まれていても曖昧にならない。
function nameSizeKey(name: string, size: number): string {
  return `${size}|${name}`
}

type RawRow = {
  id: string
  originalFileName: string
  fileSizeBytes: number | string
  storageBucket: string
  storagePath: string
  content_hash: string | null
}

/**
 * 生きている書類（deletedAt is null）を読み込んで索引を組む。
 * ソフト削除した書類は対象外＝削除後に同じファイルを上げ直す運用は通る。
 *
 * 規模の前提: 1 テナントあたり月 25 件程度・現在 143 件。全件読んでも軽いので
 * 索引はアップロード 1 回につき 1 度だけ組む。数万件規模になったら
 * 「今回のハッシュと同名同サイズだけを引く」問い合わせに切り替えること。
 */
export async function loadDedupeIndex(tenantId: string): Promise<DedupeIndex> {
  const { data, error } = await supabase
    .from('pdf_documents')
    .select('id, originalFileName, fileSizeBytes, storageBucket, storagePath, content_hash')
    .eq('tenant_id', tenantId)
    .is('deletedAt', null)

  if (error) {
    // 索引が読めないときは重複判定を諦める（取り込み自体は続行する）。
    console.error('[pdf-dedupe] 既存書類の読み込みに失敗:', error.message)
  }

  const byHash = new Map<string, DedupeRow>()
  const legacyByNameSize = new Map<string, DedupeRow[]>()

  for (const raw of (data ?? []) as RawRow[]) {
    const row: DedupeRow = {
      id: raw.id,
      originalFileName: raw.originalFileName,
      fileSizeBytes: Number(raw.fileSizeBytes),
      storageBucket: raw.storageBucket,
      storagePath: raw.storagePath,
      contentHash: raw.content_hash,
    }
    if (row.contentHash) {
      if (!byHash.has(row.contentHash)) byHash.set(row.contentHash, row)
      continue
    }
    const key = nameSizeKey(row.originalFileName, row.fileSizeBytes)
    const arr = legacyByNameSize.get(key)
    if (arr) arr.push(row)
    else legacyByNameSize.set(key, [row])
  }

  return { tenantId, byHash, legacyByNameSize }
}

/**
 * ハッシュ未計算の既存行を 1 件だけ確定させる。
 * ストレージから読めなければ null を返し、以後この行は候補から外す（毎回試さない）。
 */
async function resolveLegacyHash(index: DedupeIndex, row: DedupeRow): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(row.storageBucket)
      .download(row.storagePath)
    if (error || !data) {
      console.error(
        `[pdf-dedupe] 既存 PDF を読めずハッシュ未確定 (${row.id}):`,
        error?.message ?? 'no data',
      )
      return null
    }

    const hash = sha256(Buffer.from(await data.arrayBuffer()))
    row.contentHash = hash
    if (!index.byHash.has(hash)) index.byHash.set(hash, row)

    // 計算できたぶんは列に残す。次回以降は download 無しで判定できる。
    const { error: updErr } = await supabase
      .from('pdf_documents')
      .update({ content_hash: hash })
      .eq('tenant_id', index.tenantId)
      .eq('id', row.id)
    if (updErr) {
      console.error(`[pdf-dedupe] content_hash の保存に失敗 (${row.id}):`, updErr.message)
    }

    return hash
  } catch (e) {
    console.error(
      `[pdf-dedupe] 既存 PDF のハッシュ計算で例外 (${row.id}):`,
      e instanceof Error ? e.message : String(e),
    )
    return null
  }
}

/**
 * 取り込もうとしている PDF が既存の書類と同一かを返す。
 *
 * 1. 確定済みハッシュに一致 → 重複
 * 2. 同名・同サイズでハッシュ未計算の既存行があれば、その行だけ実体を読んで厳密比較
 * 3. どちらでもなければ重複ではない
 */
export async function findDuplicate(
  index: DedupeIndex,
  file: { name: string; size: number; hash: string },
): Promise<DedupeRow | null> {
  const exact = index.byHash.get(file.hash)
  if (exact) return exact

  const key = nameSizeKey(file.name, file.size)
  const candidates = index.legacyByNameSize.get(key)
  if (!candidates || candidates.length === 0) return null

  // 候補は同名・同サイズに限られるので、実体を読むのは高々数件。
  const unresolved: DedupeRow[] = []
  let hit: DedupeRow | null = null

  for (const row of candidates) {
    if (hit) {
      unresolved.push(row)
      continue
    }
    const hash = await resolveLegacyHash(index, row)
    if (hash === null) continue // 読めなかった行は候補から落とす（安全側＝重複としない）
    if (hash === file.hash) hit = row
  }

  if (unresolved.length > 0) index.legacyByNameSize.set(key, unresolved)
  else index.legacyByNameSize.delete(key)

  return hit
}

/** 取り込んだ書類を索引に足す。同じバッチ内に同一ファイルが 2 つある場合に効く。 */
export function registerUploaded(index: DedupeIndex, row: DedupeRow): void {
  if (row.contentHash && !index.byHash.has(row.contentHash)) {
    index.byHash.set(row.contentHash, row)
  }
}
