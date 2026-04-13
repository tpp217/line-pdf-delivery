/**
 * シンプルな cron 式パーサー (JST ベース)
 *
 * cron 式の時刻は JST として解釈し、nextRunAt は UTC の ISO 文字列で返す。
 * Vercel Cron (UTC) がチェックするときに正しく比較できる。
 */

const JST_OFFSET = 9 * 60 // JST = UTC+9 (分)

function toJST(date: Date): Date {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  return new Date(utc + JST_OFFSET * 60000)
}

function fromJST(jstDate: Date): Date {
  const utc = jstDate.getTime() - JST_OFFSET * 60000 + jstDate.getTimezoneOffset() * 60000
  return new Date(utc)
}

export function getNextRun(cronExpression: string, after: Date = new Date()): Date {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(' ')

  const jst = toJST(after)
  jst.setSeconds(0, 0)
  jst.setMinutes(jst.getMinutes() + 1)

  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matches(jst.getMinutes(), minute) &&
        matches(jst.getHours(), hour) &&
        matches(jst.getDate(), dayOfMonth) &&
        matches(jst.getMonth() + 1, month) &&
        matches(jst.getDay(), dayOfWeek)) {
      return fromJST(jst)
    }
    jst.setMinutes(jst.getMinutes() + 1)
  }

  return fromJST(jst)
}

function matches(value: number, pattern: string): boolean {
  if (pattern === '*') return true
  return pattern.split(',').some((p) => {
    if (p.includes('/')) {
      const [, step] = p.split('/')
      return value % parseInt(step) === 0
    }
    return parseInt(p) === value
  })
}
