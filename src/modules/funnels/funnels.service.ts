import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'

// ─── Funnels ──────────────────────────────────────────────────────────────────

export async function listFunnels(db: PrismaClient, tenantId: string) {
  return db.funnel.findMany({
    where: { tenantId, isActive: true },
    orderBy: { order: 'asc' },
    include: {
      stages: {
        orderBy: { order: 'asc' },
        include: {
          agentConfig: true,
          triggers: { where: { isActive: true }, select: { id: true, event: true, action: true } },
        },
      },
    },
  })
}

export async function createFunnel(
  db: PrismaClient,
  tenantId: string,
  body: { name: string; description?: string; order?: number },
) {
  return db.funnel.create({
    data: { tenantId, name: body.name, description: body.description, order: body.order ?? 0 },
  })
}

export async function updateFunnel(
  db: PrismaClient,
  tenantId: string,
  id: string,
  body: { name?: string; description?: string; order?: number },
) {
  return db.funnel.update({ where: { id, tenantId }, data: body })
}

export async function deleteFunnel(db: PrismaClient, tenantId: string, id: string) {
  return db.funnel.update({ where: { id, tenantId }, data: { isActive: false } })
}

// ─── Stages ───────────────────────────────────────────────────────────────────

export async function listStages(db: PrismaClient, tenantId: string, funnelId: string) {
  return db.stage.findMany({
    where: { funnelId, tenantId },
    orderBy: { order: 'asc' },
    include: {
      agentConfig: true,
      triggers: { orderBy: { createdAt: 'asc' } },
    },
  })
}

export async function createStage(
  db: PrismaClient,
  tenantId: string,
  funnelId: string,
  body: { name: string; color?: string; order: number; isTerminal?: boolean },
) {
  return db.stage.create({
    data: {
      tenantId,
      funnelId,
      name: body.name,
      color: body.color ?? '#64748b',
      order: body.order,
      isTerminal: body.isTerminal ?? false,
    },
  })
}

export async function updateStage(
  db: PrismaClient,
  tenantId: string,
  id: string,
  body: { name?: string; color?: string; order?: number; isTerminal?: boolean },
) {
  return db.stage.update({ where: { id, tenantId }, data: body })
}

export async function deleteStage(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  id: string,
) {
  const activeContacts = await db.contact.count({
    where: { currentStageId: id, isActive: true },
  })
  if (activeContacts > 0) {
    throw fastify.httpErrors.badRequest(
      `Cannot delete stage with ${activeContacts} active contact(s). Move them first.`,
    )
  }
  return db.stage.delete({ where: { id, tenantId } })
}

// ─── Stage Agent Config ───────────────────────────────────────────────────────

export async function getStageAgentConfig(db: PrismaClient, tenantId: string, stageId: string) {
  await db.stage.findFirstOrThrow({ where: { id: stageId, tenantId } })
  return db.stageAgentConfig.findUnique({ where: { stageId } })
}

export async function upsertStageAgentConfig(
  db: PrismaClient,
  tenantId: string,
  stageId: string,
  body: {
    funnelAgentName?: string
    funnelAgentPersonality?: string
    stageContext?: string
    allowedTools?: string[]
    model?: 'HAIKU' | 'SONNET'
    temperature?: number
  },
) {
  await db.stage.findFirstOrThrow({ where: { id: stageId, tenantId } })
  return db.stageAgentConfig.upsert({
    where: { stageId },
    create: {
      stageId,
      funnelAgentName: body.funnelAgentName ?? 'Assistente',
      funnelAgentPersonality: body.funnelAgentPersonality,
      stageContext: body.stageContext,
      allowedTools: body.allowedTools ?? [],
      model: body.model ?? 'SONNET',
      temperature: body.temperature ?? 0.3,
    },
    update: {
      ...(body.funnelAgentName !== undefined && { funnelAgentName: body.funnelAgentName }),
      ...(body.funnelAgentPersonality !== undefined && { funnelAgentPersonality: body.funnelAgentPersonality }),
      ...(body.stageContext !== undefined && { stageContext: body.stageContext }),
      ...(body.allowedTools !== undefined && { allowedTools: body.allowedTools }),
      ...(body.model !== undefined && { model: body.model }),
      ...(body.temperature !== undefined && { temperature: body.temperature }),
    },
  })
}

// ─── Triggers ─────────────────────────────────────────────────────────────────

export async function listTriggers(db: PrismaClient, tenantId: string, stageId: string) {
  await db.stage.findFirstOrThrow({ where: { id: stageId, tenantId } })
  return db.trigger.findMany({
    where: { stageId, tenantId },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createTrigger(
  db: PrismaClient,
  tenantId: string,
  stageId: string,
  body: {
    event: string
    action: string
    actionConfig: Record<string, unknown>
    conditionConfig?: Record<string, unknown>
    delayMinutes?: number
    cooldownSeconds?: number
  },
) {
  return db.trigger.create({
    data: {
      tenantId,
      stageId,
      event: body.event as never,
      action: body.action as never,
      actionConfig: body.actionConfig as never,
      conditionConfig: (body.conditionConfig ?? null) as never,
      delayMinutes: body.delayMinutes ?? 0,
      cooldownSeconds: body.cooldownSeconds ?? 3600,
      isActive: true,
    },
  })
}

export async function updateTrigger(
  db: PrismaClient,
  tenantId: string,
  id: string,
  body: Partial<{
    event: string
    action: string
    actionConfig: Record<string, unknown>
    conditionConfig: Record<string, unknown>
    delayMinutes: number
    cooldownSeconds: number
  }>,
) {
  return db.trigger.update({
    where: { id, tenantId },
    data: {
      ...(body.event && { event: body.event as never }),
      ...(body.action && { action: body.action as never }),
      ...(body.actionConfig && { actionConfig: body.actionConfig as never }),
      ...(body.conditionConfig !== undefined && { conditionConfig: body.conditionConfig as never }),
      ...(body.delayMinutes !== undefined && { delayMinutes: body.delayMinutes }),
      ...(body.cooldownSeconds !== undefined && { cooldownSeconds: body.cooldownSeconds }),
    },
  })
}

export async function deleteTrigger(db: PrismaClient, tenantId: string, id: string) {
  return db.trigger.delete({ where: { id, tenantId } })
}

export async function toggleTrigger(db: PrismaClient, tenantId: string, id: string) {
  const trigger = await db.trigger.findFirst({ where: { id, tenantId } })
  if (!trigger) return null
  return db.trigger.update({
    where: { id },
    data: { isActive: !trigger.isActive },
  })
}

// ─── Board View ───────────────────────────────────────────────────────────────

export async function getBoardView(
  db: PrismaClient,
  tenantId: string,
  funnelId: string,
  filters?: { search?: string; assignedProfessionalId?: string },
) {
  const funnel = await db.funnel.findFirstOrThrow({
    where: { id: funnelId, tenantId, isActive: true },
    select: { id: true, name: true, description: true },
  })

  const stages = await db.stage.findMany({
    where: { funnelId, tenantId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      name: true,
      color: true,
      order: true,
      isTerminal: true,
    },
  })

  const contactWhere = {
    tenantId,
    currentFunnelId: funnelId,
    isActive: true,
    ...(filters?.assignedProfessionalId && {
      assignedProfessionalId: filters.assignedProfessionalId,
    }),
    ...(filters?.search && {
      OR: [
        { name: { contains: filters.search, mode: 'insensitive' as const } },
        { phone: { contains: filters.search } },
      ],
    }),
  }

  const contacts = await db.contact.findMany({
    where: contactWhere,
    orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    select: {
      id: true,
      phone: true,
      name: true,
      photoUrl: true,
      status: true,
      stageEnteredAt: true,
      lastMessageAt: true,
      lastPaymentStatus: true,
      lastDetectedIntent: true,
      currentStageId: true,
      assignedProfessional: { select: { id: true, fullName: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, type: true, createdAt: true, role: true },
      },
    },
  })

  const contactsByStage = new Map<string, typeof contacts>()
  for (const stage of stages) {
    contactsByStage.set(stage.id, [])
  }
  // contacts with no stage go into a virtual null bucket (ignored on board)
  for (const contact of contacts) {
    if (contact.currentStageId && contactsByStage.has(contact.currentStageId)) {
      contactsByStage.get(contact.currentStageId)!.push(contact)
    }
  }

  return {
    funnel,
    stages: stages.map((stage) => ({
      ...stage,
      contacts: contactsByStage.get(stage.id) ?? [],
      _count: { contacts: (contactsByStage.get(stage.id) ?? []).length },
    })),
  }
}
