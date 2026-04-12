import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function GET() {
  const { data, error } = await supabase
    .from('routing_rules')
    .select('*, recipient:recipients(*)')
    .order('priority', { ascending: false })
    .order('createdAt', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { matchType, companyKey, recipientId, priority } = body

  if (!companyKey || !recipientId) {
    return Response.json({ error: 'companyKey と recipientId は必須です' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('routing_rules')
    .insert({
      matchType: matchType || 'CONTAINS',
      companyKey,
      recipientId,
      priority: priority ?? 0,
      isActive: true,
    })
    .select('*, recipient:recipients(*)')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
