import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'

export async function listMembers(db: PrismaClient, tenantId: string) {
  const members = await db.tenantMember.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
    include: {
      professional: { select: { id: true, fullName: true, specialty: true } },
    },
  })

  const userIds = members.map((m) => m.userId).filter((id) => id && id.length > 0)
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, image: true },
  })
  const userMap = new Map(users.map((u) => [u.id, u]))

  return members.map((m) => ({
    ...m,
    user: userMap.get(m.userId) ?? null,
  }))
}

export async function listInvitations(db: PrismaClient, tenantId: string) {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { clerkOrgId: true } })
  if (!tenant) return []

  const invitations = await db.invitation.findMany({
    where: { organizationId: tenant.clerkOrgId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
  })

  const extras = await db.invitationExtra.findMany({
    where: { invitationId: { in: invitations.map((i) => i.id) } },
    select: { invitationId: true, role: true },
  })
  const extraMap = new Map(extras.map((e) => [e.invitationId, e]))

  const roleMap: Record<string, string> = { admin: 'ADMIN', owner: 'ADMIN', member: 'Membro' }

  return invitations.map((inv) => {
    const extra = extraMap.get(inv.id)
    const role = extra?.role ?? roleMap[inv.role ?? ''] ?? inv.role ?? 'Membro'
    const isExpired = inv.status === 'pending' && new Date(inv.expiresAt) < new Date()
    const status = isExpired ? 'expired' : inv.status
    return { ...inv, role, status }
  })
}

export async function inviteMember(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  body: { email: string; role: string; professionalId?: string },
  headers: HeadersInit,
) {
  const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { clerkOrgId: true } })
  if (!tenant) throw fastify.httpErrors.notFound('Tenant not found')

  // Better Auth aceita apenas owner|admin|member; mapeamos nossos roles
  const roleForAuth = body.role === 'ADMIN' ? 'admin' : 'member'

  const result = await fastify.auth.api.createInvitation({
    body: {
      email: body.email,
      role: roleForAuth,
      organizationId: tenant.clerkOrgId,
    },
    headers,
  })

  if (!result?.id) {
    throw fastify.httpErrors.badRequest('Failed to create invitation')
  }

  await db.invitationExtra.upsert({
    where: { invitationId: result.id },
    create: { invitationId: result.id, role: body.role, professionalId: body.professionalId ?? null },
    update: { role: body.role, professionalId: body.professionalId ?? null },
  })

  return { id: result.id, email: body.email, role: body.role, status: 'pending' }
}

export async function updateMemberRole(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  id: string,
  body: { role?: string; professionalId?: string },
) {
  const member = await db.tenantMember.findFirst({ where: { id, tenantId } })
  if (!member) throw fastify.httpErrors.notFound('Member not found')

  return db.tenantMember.update({
    where: { id },
    data: {
      ...(body.role && { role: body.role as never }),
      ...(body.professionalId !== undefined && { professionalId: body.professionalId }),
    },
  })
}

export async function removeMember(db: PrismaClient, tenantId: string, id: string) {
  return db.tenantMember.update({
    where: { id, tenantId },
    data: { isActive: false },
  })
}
