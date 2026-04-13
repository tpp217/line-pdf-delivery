/**
 * シンプルな cron 式パーサー
 * 対応パターン:
 *   "1 10 * * *"    → 毎日10:01
 *   "0 9 1 * *"     → 毎月1日 9:00
 *   "0 9 * * 1"     → 毎週月曜 9:00
 *   "0 9 1,15 * *"  → 毎月1日と15日 9:00
 */
export function getNextRun(cronExpression: string, after: Date = new Date()): Date {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(' ')

  const next = new Date(after)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)

  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matches(next.getMinutes(), minute) &&
        matches(next.getHours(), hour) &&
        matches(next.getDate(), dayOfMonth) &&
        matches(next.getMonth() + 1, month) &&
        matches(next.getDay(), dayOfWeek)) {
      return next
    }
    next.setMinutes(next.getMinutes() + 1)
  }

  return next
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

/**
 * 人間が読める繰り返し説明を生成
 */
export function describeCron(cron: string): string {
  const [min, hour, dom, , dow] = cron.split(' ')
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`

  if (dom !== '*' && dow === '*') {
    const days = dom.split(',').join('・')
    return `毎月${days}日 ${time}`
  }
  if (dow !== '*' && dom === '*') {
    const dayNames = ['日', '月', '火', '水', '木', '金', '土']
    const days = dow.split(',').map((d) => dayNames[parseInt(d)] || d).join('・')
    return `毎週${days}曜 ${time}`
  }
  if (dom === '*' && dow === '*') {
    return `毎日 ${time}`
  }
  return cron
}
