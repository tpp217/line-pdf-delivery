export async function extractTextFromPdf(
  pdfBuffer: Buffer,
): Promise<{ text: string; pageCount: number }> {
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
    const result = await parser.getText()
    await parser.destroy()
    return { text: result.text || '', pageCount: result.total || 0 }
  } catch {
    return { text: '', pageCount: 0 }
  }
}

export function extractNames(text: string): {
  companyName: string | null
  personName: string | null
} {
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
