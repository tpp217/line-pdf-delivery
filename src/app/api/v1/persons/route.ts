import { supabase } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function GET() {
  const { data, error } = await supabase
    .from('persons')
    .select('*')
    .order('name', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const { name, categories } = await request.json()
  if (!name) return Response.json({ error: 'name は必須です' }, { status: 400 })

  const { data, error } = await supabase
    .from('persons')
    .upsert({ name, categories: categories || [] }, { onConflict: 'name' })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
