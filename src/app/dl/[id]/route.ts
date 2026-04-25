import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

/**
 * 短縮URL: /dl/{id}
 *
 * id は UUID（pdf_documents.id）または短縮コード（short_code）を受け付ける。
 * LINE のアプリ内ブラウザは Content-Disposition: attachment を直接扱えず
 * 「(null)」の読み込みが繰り返されるため、ここではHTMLのランディング
 * ページを返す。実ファイルは /dl/{id}/file が担当する。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const ua = req.headers.get('user-agent') ?? ''
  const isIOS = /iPhone|iPad|iPod/i.test(ua)

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

  const { data: pdf } = await supabase
    .from('pdf_documents')
    .select('originalFileName, fileSizeBytes, personName')
    .eq(isUuid ? 'id' : 'short_code', id)
    .is('deletedAt', null)
    .maybeSingle()

  if (!pdf) {
    return htmlResponse(renderNotFound('このリンクは無効か、既に削除されています'), 404)
  }

  return htmlResponse(
    renderLanding({
      id,
      originalFileName: pdf.originalFileName,
      sizeStr: formatBytes(pdf.fileSizeBytes),
      personName: pdf.personName,
      isIOS,
    }),
    200,
  )
}

function htmlResponse(body: string, status: number): Response {
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  })
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const STYLES = `
:root {
  --bg: #FAFBFC; --surface: #FFFFFF; --border: #E4E8EC;
  --text: #1A1F24; --text-2: #5B6672; --text-3: #8C96A1;
  --blue: #2563EB; --blue-2: #1D4ED8; --blue-soft: #EFF4FE; --blue-border: #C9DAF8;
  --red-soft: #FDECEC; --red: #DC2626;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic Medium", sans-serif;
  font-size: 14px; color: var(--text); background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; -webkit-font-smoothing: antialiased;
}
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 24px 20px; width: 100%; max-width: 420px;
  box-shadow: 0 2px 8px rgba(17,24,39,0.04);
}
.ico {
  width: 48px; height: 48px; border-radius: 8px;
  background: var(--red-soft); color: var(--red);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; letter-spacing: 0.02em;
  margin-bottom: 16px;
}
.name { font-size: 16px; font-weight: 600; line-height: 1.4; margin-bottom: 4px; word-break: break-all; }
.meta { font-size: 12px; color: var(--text-3); margin-bottom: 20px; word-break: break-all; }
.meta__row { display: block; }
.btn {
  display: block; width: 100%; padding: 14px 16px; background: var(--blue); color: #fff;
  border: none; border-radius: 6px; font-size: 15px; font-weight: 600;
  text-align: center; text-decoration: none; cursor: pointer;
  transition: background 0.12s;
}
.btn:active, .btn:hover { background: var(--blue-2); }
.btn--secondary {
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
}
.btn--secondary:active, .btn--secondary:hover {
  background: var(--bg); border-color: var(--text-3);
}
.btn-row { display: flex; flex-direction: column; gap: 8px; }
.hint { margin-top: 14px; font-size: 12px; color: var(--text-3); line-height: 1.5; }
.ios-hint {
  margin-top: 14px; padding: 10px 12px;
  background: var(--blue-soft); border: 1px solid var(--blue-border);
  border-radius: 6px; font-size: 12px; line-height: 1.6; color: var(--blue-2);
}
.ios-hint__title { font-weight: 600; margin-bottom: 4px; }
.ios-hint__steps { padding-left: 16px; }
.ios-hint__steps li { margin-bottom: 2px; }
.err { color: var(--red); font-size: 15px; }
`

function renderLanding(p: {
  id: string
  originalFileName: string
  sizeStr: string
  personName: string | null
  isIOS: boolean
}): string {
  const iosHint = p.isIOS
    ? `
    <div class="ios-hint">
      <div class="ios-hint__title">iPhone で保存先を選ぶには</div>
      <ol class="ios-hint__steps">
        <li>上の「ダウンロード」をタップ</li>
        <li>画面下の「…」から「共有」をタップ</li>
        <li>「ファイルに保存」→ 保存したいフォルダを選択</li>
      </ol>
    </div>`
    : ''

  const title = p.personName || p.originalFileName

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escape(title)} | LINE PDF</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="ico">PDF</div>
    <div class="name">${escape(title)}</div>
    <div class="meta">
      <span class="meta__row">${escape(p.originalFileName)}</span>
      ${p.sizeStr ? `<span class="meta__row">${escape(p.sizeStr)}</span>` : ''}
    </div>
    <div class="btn-row">
      <a class="btn" href="/dl/${encodeURIComponent(p.id)}/view" target="_blank" rel="noopener">
        表示する
      </a>
      <a class="btn btn--secondary" href="/dl/${encodeURIComponent(p.id)}/file" download>
        ダウンロード
      </a>
    </div>${iosHint}
    <p class="hint">
      うまく保存できない場合は、ブラウザで開き直してから再度お試しください。
    </p>
  </div>
</body>
</html>`
}

function renderNotFound(message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>リンクが見つかりません</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="name err">リンクが見つかりません</div>
    <div class="meta">${escape(message)}</div>
  </div>
</body>
</html>`
}
