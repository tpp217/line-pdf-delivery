import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const { personName } = await request.json()
  if (!personName) {
    return Response.json({ matchedRules: [], suggestedRecipients: [] })
  }

  const { data: rules } = await supabase
    .from('routing_rules')
    .select('*, recipient:recipients(*)')
    .eq('isActive', true)
    .order('priority', { ascending: false })

  if (!rules || rules.length === 0) {
    return Response.json({ matchedRules: [], suggestedRecipients: [] })
  }

  const matched = rules.filter((rule) => {
    switch (rule.matchType) {
      case 'EXACT':
        return personName === rule.companyKey
      case 'CONTAINS':
        return personName.includes(rule.companyKey) || rule.companyKey.includes(personName)
      case 'REGEX':
        try { return new RegExp(rule.companyKey).test(personName) } catch { return false }
      default:
        return false
    }
  })

  const recipients = matched
    .map((r) => r.recipient)
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (matched.length > 0) {
    const ids = matched.map((r) => r.id)
    await supabase
      .from('routing_rules')
      .update({ lastHitAt: new Date().toISOString() })
      .in('id', ids)
  }

  return Response.json({ matchedRules: matched, suggestedRecipients: recipients })
}
