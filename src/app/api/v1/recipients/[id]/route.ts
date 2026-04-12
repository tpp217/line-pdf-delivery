import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const recipient = await prisma.recipient.findUnique({ where: { id } })
  if (!recipient) {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }
  return Response.json(recipient)
}

export async function PATCH(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  const body = await request.json()
  const { displayName, memo, isActive, isDefault } = body

  const data: Record<string, unknown> = {}
  if (displayName !== undefined) data.displayName = displayName
  if (memo !== undefined) data.memo = memo
  if (isActive !== undefined) data.isActive = isActive
  if (isDefault !== undefined) data.isDefault = isDefault

  try {
    const recipient = await prisma.recipient.update({ where: { id }, data })
    return Response.json(recipient)
  } catch {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }
}

export async function DELETE(_req: NextRequest, ctx: Context) {
  const { id } = await ctx.params
  try {
    await prisma.recipient.update({
      where: { id },
      data: { isActive: false },
    })
    return new Response(null, { status: 204 })
  } catch {
    return Response.json({ error: '送信先が見つかりません' }, { status: 404 })
  }
}
