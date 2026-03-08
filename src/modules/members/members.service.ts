import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { sendInvitationEmail } from '../../services/email.service.js'

export async function listMembers(db: PrismaClient, tenantId: string) {
  return db.tenantMember.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'asc' },
    include: {
      professional: { select: { id: true, fullName: true, specialty: true } },
    },
  })
}

export async function inviteMember(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  inviterUserId: string,
  body: { email: string; role: string; professionalId?: string },
) {
  // Get tenant info for the invitation email
  const tenant = await db.tenant.findFirst({ where: { id: tenantId } })
  if (!tenant) throw fastify.httpErrors.notFound('Tenant not found')

  const inviter = await db.user.findFirst({ where: { id: inviterUserId } })

  // Create invitation via Better Auth — we use their internal invitation flow.
  // This endpoint stores the invitation and fires the email.
  const inviteLink = `${process.env['WEB_URL'] ?? 'https://app.ailum.com.br'}/invite?org=${tenant.slug}`

  await sendInvitationEmail({
    to: body.email,
    inviterName: inviter?.name ?? 'Administrador',
    organizationName: tenant.name,
    inviteLink,
  })

  // Record invitation in tenant_members as inactive until accepted
  return db.tenantMember.create({
    data: {
      tenantId,
      userId: '',              // empty until the user accepts and their userId is known
      role: body.role as never,
      professionalId: body.professionalId ?? null,
      isActive: false,
      invitedBy: inviterUserId,
    },
  })
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
