import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'

export async function listContacts(
  db: PrismaClient,
  tenantId: string,
  query: {
    page?: number
    limit?: number
    funnelId?: string
    stageId?: string
    status?: string
    search?: string
  },
) {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const skip = (page - 1) * limit

  const SYSTEM_PHONE_BLOCKLIST = [
    'status@broadcast',
    'status@s.whatsapp.net',
    '__playground__',
  ]

  const where = {
    tenantId,
    isActive: true,
    NOT: { phone: { in: SYSTEM_PHONE_BLOCKLIST } },
    ...(query.funnelId && { currentFunnelId: query.funnelId }),
    ...(query.stageId && { currentStageId: query.stageId }),
    ...(query.status && { status: query.status as never }),
    ...(query.search && {
      OR: [
        { name: { contains: query.search, mode: 'insensitive' as const } },
        { phone: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' as const } },
      ],
    }),
  }

  const [data, total] = await Promise.all([
    db.contact.findMany({
      where,
      skip,
      take: limit,
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      include: {
        currentStage: { select: { id: true, name: true, color: true } },
        currentFunnel: { select: { id: true, name: true } },
        assignedProfessional: { select: { id: true, fullName: true } },
      },
    }),
    db.contact.count({ where }),
  ])

  return { data, total, page, limit, pages: Math.ceil(total / limit) }
}

export async function getContactById(
  db: PrismaClient,
  tenantId: string,
  id: string,
) {
  return db.contact.findFirst({
    where: { id, tenantId, isActive: true },
    include: {
      currentStage: { include: { agentConfig: true } },
      currentFunnel: true,
      assignedProfessional: { select: { id: true, fullName: true, specialty: true } },
      appointments: {
        orderBy: { scheduledAt: 'desc' },
        take: 10,
        include: {
          professional: { select: { fullName: true } },
          service: { select: { name: true } },
        },
      },
      charges: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
      agentMemories: {
        orderBy: { updatedAt: 'desc' },
      },
    },
  })
}

export async function createContact(
  db: PrismaClient,
  tenantId: string,
  body: {
    phone: string
    name?: string
    email?: string
    notes?: string
    funnelId?: string
    stageId?: string
    assignedProfessionalId?: string
  },
) {
  return db.contact.create({
    data: {
      tenantId,
      phone: body.phone,
      name: body.name,
      email: body.email,
      notes: body.notes,
      currentFunnelId: body.funnelId,
      currentStageId: body.stageId,
      assignedProfessionalId: body.assignedProfessionalId,
      ...(body.stageId && { stageEnteredAt: new Date() }),
    },
  })
}

export async function updateContact(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  id: string,
  body: {
    name?: string
    email?: string
    notes?: string
    assignedProfessionalId?: string | null
  },
) {
  const contact = await db.contact.update({
    where: { id, tenantId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.assignedProfessionalId !== undefined && {
        assignedProfessionalId: body.assignedProfessionalId,
      }),
      updatedAt: new Date(),
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncContact(tenantId, {
    id: contact.id,
    phone: contact.phone,
    name: contact.name,
    email: contact.email,
    status: contact.status,
    currentStageId: contact.currentStageId,
    currentFunnelId: contact.currentFunnelId,
    lastMessageAt: contact.lastMessageAt,
    assignedProfessionalId: contact.assignedProfessionalId,
  })

  return contact
}

export async function moveContactStage(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  contactId: string,
  stageId: string,
  funnelId?: string,
) {
  const stage = await db.stage.findFirst({
    where: { id: stageId, tenantId },
    include: { funnel: { select: { id: true } } },
  })
  if (!stage) {
    throw fastify.httpErrors.notFound('Stage not found')
  }
  if (funnelId != null && stage.funnelId !== funnelId) {
    throw fastify.httpErrors.badRequest('Stage does not belong to the specified funnel')
  }

  const contact = await db.contact.update({
    where: { id: contactId, tenantId },
    data: {
      currentStageId: stageId,
      currentFunnelId: stage.funnelId,
      stageEnteredAt: new Date(),
      updatedAt: new Date(),
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncContact(tenantId, {
    id: contact.id,
    phone: contact.phone,
    name: contact.name,
    email: contact.email,
    status: contact.status,
    currentStageId: contact.currentStageId,
    currentFunnelId: contact.currentFunnelId,
    lastMessageAt: contact.lastMessageAt,
    assignedProfessionalId: contact.assignedProfessionalId,
  })

  return contact
}

export async function softDeleteContact(
  db: PrismaClient,
  tenantId: string,
  id: string,
) {
  return db.contact.update({
    where: { id, tenantId },
    data: { isActive: false, updatedAt: new Date() },
  })
}
