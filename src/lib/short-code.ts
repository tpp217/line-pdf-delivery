import { customAlphabet } from 'nanoid'
import { supabase } from './supabase'

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)

/**
 * PDFのshort_codeを取得（既存があればそれを返す、なければ生成して保存）
 */
export async function getOrCreateShortCode(pdfId: string): Promise<string> {
  // 既存コードがあればそのまま返す
  const { data: existing } = await supabase
    .from('pdf_documents')
    .select('short_code')
    .eq('id', pdfId)
    .maybeSingle()

  if (existing?.short_code) return existing.short_code

  // 新規生成（衝突時リトライ最大3回）
  for (let i = 0; i < 3; i++) {
    const code = nanoid()
    const { error } = await supabase
      .from('pdf_documents')
      .update({ short_code: code })
      .eq('id', pdfId)

    if (!error) return code

    // unique制約違反以外はそのまま投げる
    if (error.code !== '23505') throw error
  }

  throw new Error('短縮コード生成に失敗しました（衝突回数超過）')
}
