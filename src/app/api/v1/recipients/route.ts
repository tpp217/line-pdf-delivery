import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const isActive = searchParams.get('isActive')
  const isDefault = searchParams.get('isDefault')

  const where: Record<string, unknown> = {}
  if (isActive !== null) where.isActive = isActive === 'true'
  if (isDefault !== null) where.isDefault = isDefault === 'true'
  if (keyword) {
    where.OR = [
      { displayName: { contains: keyword, mode: 'insensitive' } },
      { memo: { contains: keyword, mode: 'insensitive' } },
    ]
  }

  const recipients = await prisma.recipient.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return Response.json(recipients)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { displayName, lineUserId, memo, isActive, isDefault } = body

  if (!displayName || !lineUserId) {
    return Response.json(
      { error: 'displayName と lineUserId は必須です' },
      { status: 400 },
    )
  }

  const existing = await prisma.recipient.findUnique({
    where: { lineUserId },
  })
  if (existing) {
    return Response.json(
      { error: 'この lineUserId は既に登録されています' },
      { status: 409 },
    )
  }

  const recipient = await prisma.recipient.create({
    data: {
      displayName,
      lineUserId,
      memo: memo ?? null,
      isActive: isActive ?? true,
      isDefault: isDefault ?? false,
    },
  })

  return Response.json(recipient, { status: 201 })
}
