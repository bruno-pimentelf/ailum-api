import type { FastifyInstance } from 'fastify'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'
import { createPixCharge as asaasCreatePixCharge } from '../../services/asaas.service.js'
import { ZapiService } from '../../services/zapi.service.js'
import { STATUS_TRANSITIONS } from '../../constants/status-transitions.js'
import type { AgentContext } from '../../types/context.js'

export interface ToolResult {
  success: boolean
  requiresConfirmation: boolean
  data?: Record<string, unknown>
  reason?: string
}

// ─── Tool input types ─────────────────────────────────────────────────────────

interface CreateAppointmentInput {
  professional_id: string
  service_id: string
  scheduled_at: string
  notes?: string
}

interface GeneratePixInput {
  amount: number
  description: string
  appointment_id?: string
  due_hours?: number
}

interface MoveStageInput {
  stage_id: string
  reason?: string
}

interface NotifyOperatorInput {
  reason: string
  urgency: 'low' | 'medium' | 'high'
}

interface SendMessageInput {
  content: string
  type?: string
  media_url?: string
}

// ─── Executor ────────────────────────────────────────────────────────────────

export async function executeToolSafely(
  toolName: string,
  input: Record<string, unknown>,
  context: AgentContext,
  fastify: FastifyInstance,
): Promise<ToolResult> {
  const db = fastify.db
  const firebaseSync = new FirebaseSyncService(fastify.firebase.firestore)

  try {
    switch (toolName) {
      case 'create_appointment':
        return await createAppointment(input as unknown as CreateAppointmentInput, context, db, firebaseSync)

      case 'generate_pix':
        return await generatePix(input as unknown as GeneratePixInput, context, db, firebaseSync)

      case 'move_stage':
        return await moveStage(input as unknown as MoveStageInput, context, db, firebaseSync)

      case 'notify_operator':
        return await notifyOperator(input as unknown as NotifyOperatorInput, context, db, firebaseSync, fastify)

      case 'send_message':
        return await sendMessage(input as unknown as SendMessageInput, context, db, firebaseSync, fastify)

      default:
        return { success: false, requiresConfirmation: false, reason: `Unknown tool: ${toolName}` }
    }
  } catch (err) {
    fastify.log.error({ err, toolName, input }, 'tool-executor:error')
    return {
      success: false,
      requiresConfirmation: false,
      reason: err instanceof Error ? err.message : 'Unexpected error',
    }
  }
}

// ─── create_appointment ───────────────────────────────────────────────────────

async function createAppointment(
  input: CreateAppointmentInput,
  context: AgentContext,
  db: FastifyInstance['db'],
  sync: FirebaseSyncService,
): Promise<ToolResult> {
  const scheduledAt = new Date(input.scheduled_at)

  // Fetch service for duration
  const service = await db.service.findFirst({
    where: { id: input.service_id, tenantId: context.tenant.id },
  })
  if (!service) {
    return { success: false, requiresConfirmation: false, reason: 'Serviço não encontrado' }
  }

  // Check for scheduling conflicts
  const conflictEnd = new Date(scheduledAt.getTime() + service.durationMin * 60_000)
  const conflict = await db.appointment.findFirst({
    where: {
      professionalId: input.professional_id,
      status: { in: ['PENDING', 'CONFIRMED'] },
      scheduledAt: { lt: conflictEnd },
      AND: [
        {
          scheduledAt: {
            gte: new Date(scheduledAt.getTime() - service.durationMin * 60_000),
          },
        },
      ],
    },
  })

  if (conflict) {
    return { success: false, requiresConfirmation: true, reason: 'Horário indisponível. Outro agendamento já ocupa esse horário.' }
  }

  const appointment = await db.appointment.create({
    data: {
      tenantId: context.tenant.id,
      contactId: context.contact.id,
      professionalId: input.professional_id,
      serviceId: input.service_id,
      scheduledAt,
      durationMin: service.durationMin,
      notes: input.notes,
      createdBy: 'agent',
    },
  })

  // Advance contact status
  const newStatus = STATUS_TRANSITIONS['create_appointment']
  await db.contact.update({
    where: { id: context.contact.id },
    data: { status: newStatus, updatedAt: new Date() },
  })

  await sync.updateContactPresence({
    tenantId: context.tenant.id,
    contactId: context.contact.id,
    status: newStatus,
    stageId: context.contact.currentStageId,
    lastMessageAt: new Date(),
  })

  return {
    success: true,
    requiresConfirmation: true,
    data: {
      appointmentId: appointment.id,
      scheduledAt: appointment.scheduledAt.toISOString(),
      durationMin: appointment.durationMin,
    },
  }
}

// ─── generate_pix ─────────────────────────────────────────────────────────────

async function generatePix(
  input: GeneratePixInput,
  context: AgentContext,
  db: FastifyInstance['db'],
  sync: FirebaseSyncService,
): Promise<ToolResult> {
  // Idempotency — return existing pending charge
  const existing = await db.charge.findFirst({
    where: { contactId: context.contact.id, tenantId: context.tenant.id, status: 'PENDING' },
  })
  if (existing) {
    return {
      success: true,
      requiresConfirmation: true,
      data: {
        chargeId: existing.id,
        amount: String(existing.amount),
        pixCopyPaste: existing.pixCopyPaste,
        alreadyExists: true,
      },
    }
  }

  if (!context.asaasIntegration) {
    return { success: false, requiresConfirmation: false, reason: 'Integração Asaas não configurada' }
  }

  // Validate against tenant max PIX amount
  const maxAmount = Number(context.tenant.maxPixAmount)
  if (input.amount > maxAmount) {
    return {
      success: false,
      requiresConfirmation: false,
      reason: `Valor R$ ${input.amount} excede o limite máximo de R$ ${maxAmount}`,
    }
  }

  const dueHours = input.due_hours ?? 24
  const dueDate = new Date(Date.now() + dueHours * 3_600_000)
    .toISOString()
    .split('T')[0]!

  const pixResponse = await asaasCreatePixCharge(context.asaasIntegration.apiKey, {
    contactName: context.contact.name ?? context.contact.phone,
    phone: context.contact.phone,
    email: context.contact.email ?? undefined,
    value: input.amount,
    description: input.description,
    dueDate,
    externalReference: context.contact.id,
  })

  const charge = await db.charge.create({
    data: {
      tenantId: context.tenant.id,
      contactId: context.contact.id,
      appointmentId: input.appointment_id ?? null,
      asaasPaymentId: pixResponse.id,
      amount: input.amount,
      description: input.description,
      pixCopyPaste: pixResponse.payload,
      qrCodeBase64: pixResponse.encodedImage,
      dueAt: new Date(pixResponse.expirationDate),
    },
  })

  // Advance contact status
  const newStatus = STATUS_TRANSITIONS['generate_pix']
  await db.contact.update({
    where: { id: context.contact.id },
    data: { status: newStatus, updatedAt: new Date() },
  })

  await sync.updateContactPresence({
    tenantId: context.tenant.id,
    contactId: context.contact.id,
    status: newStatus,
    stageId: context.contact.currentStageId,
    lastMessageAt: new Date(),
  })

  return {
    success: true,
    requiresConfirmation: true,
    data: {
      chargeId: charge.id,
      amount: String(charge.amount),
      pixCopyPaste: pixResponse.payload,
      qrCodeUrl: `data:image/png;base64,${pixResponse.encodedImage}`,
      dueAt: charge.dueAt?.toISOString(),
    },
  }
}

// ─── move_stage ───────────────────────────────────────────────────────────────

async function moveStage(
  input: MoveStageInput,
  context: AgentContext,
  db: FastifyInstance['db'],
  sync: FirebaseSyncService,
): Promise<ToolResult> {
  const stage = await db.stage.findFirst({
    where: { id: input.stage_id, tenantId: context.tenant.id },
  })

  if (!stage) {
    return { success: false, requiresConfirmation: false, reason: 'Stage não encontrado' }
  }

  await db.contact.update({
    where: { id: context.contact.id },
    data: {
      currentStageId: stage.id,
      currentFunnelId: stage.funnelId,
      stageEnteredAt: new Date(),
      updatedAt: new Date(),
    },
  })

  await sync.updateContactPresence({
    tenantId: context.tenant.id,
    contactId: context.contact.id,
    status: context.contact.status,
    stageId: stage.id,
    lastMessageAt: null,
  })

  return {
    success: true,
    requiresConfirmation: false,
    data: { stageId: stage.id, stageName: stage.name },
  }
}

// ─── notify_operator ──────────────────────────────────────────────────────────

async function notifyOperator(
  input: NotifyOperatorInput,
  context: AgentContext,
  db: FastifyInstance['db'],
  sync: FirebaseSyncService,
  fastify: FastifyInstance,
): Promise<ToolResult> {
  // Find admin/secretary members with associated users
  const adminMembers = await db.tenantMember.findMany({
    where: {
      tenantId: context.tenant.id,
      role: { in: ['ADMIN', 'SECRETARY'] },
      isActive: true,
    },
    take: 3,
  })

  const urgencyEmoji = { low: '🔵', medium: '🟡', high: '🔴' }[input.urgency]
  const notifyMessage = `${urgencyEmoji} *Atenção: Atendimento Humano Solicitado*\n\nContato: ${context.contact.name ?? context.contact.phone}\nTelefone: ${context.contact.phone}\nMotivo: ${input.reason}\nUrgência: ${input.urgency}`

  if (context.zapiIntegration && adminMembers.length > 0) {
    const zapi = new ZapiService()
    for (const member of adminMembers) {
      // We'd need the admin's phone — for now, log it
      fastify.log.info(
        { memberId: member.id, message: notifyMessage },
        'notify_operator:sending',
      )
      // TODO: get admin user phone from user table and send via zapi
    }
  }

  // Update contact status
  const newStatus = STATUS_TRANSITIONS['notify_operator']
  await db.contact.update({
    where: { id: context.contact.id },
    data: { status: newStatus, updatedAt: new Date() },
  })

  await sync.updateContactPresence({
    tenantId: context.tenant.id,
    contactId: context.contact.id,
    status: newStatus,
    stageId: context.contact.currentStageId,
    lastMessageAt: new Date(),
  })

  return {
    success: true,
    requiresConfirmation: false,
    data: { notifiedCount: adminMembers.length, reason: input.reason },
  }
}

// ─── send_message ─────────────────────────────────────────────────────────────

async function sendMessage(
  input: SendMessageInput,
  context: AgentContext,
  db: FastifyInstance['db'],
  sync: FirebaseSyncService,
  fastify: FastifyInstance,
): Promise<ToolResult> {
  if (context.zapiIntegration?.isActive && context.zapiIntegration.instanceId) {
    const zapi = new ZapiService()

    if (input.type && input.type !== 'TEXT' && input.media_url) {
      await zapi.sendMedia({
        instanceId: context.zapiIntegration.instanceId,
        apiKey: context.zapiIntegration.apiKey,
        phone: context.contact.phone,
        message: input.content,
        mediaUrl: input.media_url,
        caption: input.content,
        type: input.type.toLowerCase() as 'image' | 'audio' | 'document',
      })
    } else {
      await zapi.sendText({
        instanceId: context.zapiIntegration.instanceId,
        apiKey: context.zapiIntegration.apiKey,
        phone: context.contact.phone,
        message: input.content,
      })
    }
  }

  // Save to DB
  const savedMessage = await db.message.create({
    data: {
      tenantId: context.tenant.id,
      contactId: context.contact.id,
      role: 'AGENT',
      type: (input.type as 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT') ?? 'TEXT',
      content: input.content,
    },
  })

  await sync.syncMessage({
    tenantId: context.tenant.id,
    contactId: context.contact.id,
    messageId: savedMessage.id,
    role: 'AGENT',
    type: savedMessage.type,
    content: savedMessage.content,
    createdAt: savedMessage.createdAt,
  })

  return {
    success: true,
    requiresConfirmation: false,
    data: { messageId: savedMessage.id },
  }
}
