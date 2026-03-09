import type { FastifyInstance } from 'fastify'
import { decrypt } from '../../config/encryption.js'
import type {
  AgentContext,
  AvailableProfessional,
  AvailableSlot,
  ContextAppointment,
  ContextAsaasIntegration,
  ContextCharge,
  ContextZapiIntegration,
} from '../../types/context.js'

function buildTimeSlots(
  startTime: string,
  endTime: string,
  slotDurationMin: number,
  existingAppointments: { scheduledAt: Date; durationMin: number }[],
  /** Em minutos desde meia-noite. Slots que começam antes são excluídos (já passaram). */
  minStartMinutesFromMidnight?: number,
): AvailableSlot[] {
  const slots: AvailableSlot[] = []
  const [startH, startM] = startTime.split(':').map(Number)
  const [endH, endM] = endTime.split(':').map(Number)

  let current = startH * 60 + (startM ?? 0)
  const end = endH * 60 + (endM ?? 0)

  const bookedMinutes = new Set<number>()
  for (const appt of existingAppointments) {
    const apptStart = appt.scheduledAt.getHours() * 60 + appt.scheduledAt.getMinutes()
    for (let m = apptStart; m < apptStart + appt.durationMin; m++) {
      bookedMinutes.add(m)
    }
  }

  while (current + slotDurationMin <= end) {
    if (minStartMinutesFromMidnight != null && current < minStartMinutesFromMidnight) {
      current += slotDurationMin
      continue
    }

    const slotFree = !Array.from({ length: slotDurationMin }, (_, i) => current + i).some((m) =>
      bookedMinutes.has(m),
    )

    if (slotFree) {
      const h = Math.floor(current / 60)
      const m = current % 60
      const eh = Math.floor((current + slotDurationMin) / 60)
      const em = (current + slotDurationMin) % 60
      slots.push({
        time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        endTime: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`,
      })
    }

    current += slotDurationMin
  }

  return slots
}

export async function buildContext(
  contactId: string,
  tenantId: string,
  fastify: FastifyInstance,
): Promise<AgentContext> {
  const db = fastify.db
  const today = new Date()
  const todayDow = today.getDay()
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const tomorrowDate = new Date(todayDate.getTime() + 86_400_000)

  const [
    contact,
    tenant,
    messages,
    nextAppointment,
    pendingCharge,
    professionalsRaw,
    servicesRaw,
    memories,
    integrations,
  ] = await Promise.all([
    // 1. Contact with stage + funnel (including all funnel stages for move_stage)
    db.contact.findUniqueOrThrow({
      where: { id: contactId },
      include: {
        currentStage: {
          include: { agentConfig: true },
        },
        currentFunnel: {
          include: {
            stages: { orderBy: { order: 'asc' }, select: { id: true, name: true, order: true } },
          },
        },
      },
    }),

    // 2. Tenant
    db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        agentBasePrompt: true,
        guardrailRules: true,
        maxPixAmount: true,
      },
    }),

    // 3. Last 20 messages (most recent first, then reverse for chronological order)
    db.message
      .findMany({
        where: { contactId, tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, role: true, content: true, type: true, createdAt: true },
      })
      .then((rows) => rows.reverse()),

    // 4. Next confirmed appointment
    db.appointment.findFirst({
      where: {
        contactId,
        tenantId,
        status: 'CONFIRMED',
        scheduledAt: { gt: today },
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        professional: { select: { fullName: true, specialty: true } },
        service: { select: { name: true, price: true } },
      },
    }),

    // 5. Pending PIX charge
    db.charge.findFirst({
      where: { contactId, tenantId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        description: true,
        status: true,
        pixCopyPaste: true,
        dueAt: true,
      },
    }),

    // 6. Professionals available today (with availability + exceptions)
    db.professional.findMany({
      where: { tenantId, isActive: true },
      include: {
        availability: { where: { dayOfWeek: todayDow } },
        availabilityExceptions: {
          where: { date: todayDate, isUnavailable: true },
        },
        appointments: {
          where: {
            scheduledAt: { gte: todayDate, lt: tomorrowDate },
            status: { in: ['PENDING', 'CONFIRMED'] },
          },
          select: { scheduledAt: true, durationMin: true },
        },
      },
    }),

    // 7. Services available for scheduling (isConsultation = true)
    db.service.findMany({
      where: { tenantId, isActive: true, isConsultation: true },
      select: { id: true, name: true, durationMin: true, price: true },
    }),

    // 8. Contact memories
    db.agentMemory.findMany({
      where: { contactId, tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { key: true, value: true, confidence: true },
    }),

    // 9. Tenant integrations (asaas + zapi)
    db.tenantIntegration.findMany({
      where: { tenantId, provider: { in: ['asaas', 'zapi'] }, isActive: true },
      select: { provider: true, instanceId: true, apiKeyEncrypted: true, isActive: true },
    }),
  ])

  // Build available professionals with time slots
  // Exclui slots que já passaram hoje (ex: às 19:19, 09:00 não é mais oferecido)
  const nowMinutes = today.getHours() * 60 + today.getMinutes()
  const minStartMinutes = nowMinutes + 15 // margem de 15 min — não oferece slot que começa em menos de 15 min

  const availableProfessionals: AvailableProfessional[] = []
  for (const prof of professionalsRaw) {
    // Skip if has an exception (holiday/day off)
    if (prof.availabilityExceptions.length > 0) continue
    // Skip if no availability configured for today
    if (prof.availability.length === 0) continue

    const slots: AvailableSlot[] = []
    for (const avail of prof.availability) {
      const built = buildTimeSlots(
        avail.startTime,
        avail.endTime,
        avail.slotDurationMin,
        prof.appointments,
        minStartMinutes,
      )
      slots.push(...built)
    }

    if (slots.length > 0) {
      availableProfessionals.push({
        id: prof.id,
        fullName: prof.fullName,
        specialty: prof.specialty,
        slots,
      })
    }
  }

  // Decrypt integration API keys
  const rawAsaas = integrations.find((i) => i.provider === 'asaas')
  const rawZapi = integrations.find((i) => i.provider === 'zapi')

  const asaasIntegration: ContextAsaasIntegration | null = rawAsaas?.apiKeyEncrypted
    ? {
        instanceId: rawAsaas.instanceId,
        apiKey: decrypt(rawAsaas.apiKeyEncrypted),
        isActive: rawAsaas.isActive,
      }
    : null

  const zapiIntegration: ContextZapiIntegration | null = rawZapi?.apiKeyEncrypted
    ? {
        instanceId: rawZapi.instanceId,
        apiKey: decrypt(rawZapi.apiKeyEncrypted),
        isActive: rawZapi.isActive,
      }
    : null

  const stage = contact.currentStage
  const funnel = contact.currentFunnel

  // Data e horário atuais para o agente construir scheduled_at e saber se há slots hoje
  const now = new Date()
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const year = now.getFullYear()
  const hours = String(now.getHours()).padStart(2, '0')
  const mins = String(now.getMinutes()).padStart(2, '0')
  const currentDate = `${day}/${month}/${year}`
  const currentTime = `${hours}:${mins}`
  const currentDateIsoExample = `${year}-${month}-${day}T09:00:00-03:00`

  const tomorrow = new Date(now.getTime() + 86_400_000)
  const tomorrowDateIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`

  return {
    currentDate,
    currentTime,
    currentDateIsoExample,
    tomorrowDateIso,
    contact: {
      id: contact.id,
      phone: contact.phone,
      name: contact.name,
      email: contact.email,
      status: contact.status,
      currentFunnelId: contact.currentFunnelId,
      currentStageId: contact.currentStageId,
      zapiSessionId: contact.zapiSessionId,
      lastDetectedIntent: contact.lastDetectedIntent,
      assignedProfessionalId: contact.assignedProfessionalId,
      stageEnteredAt: contact.stageEnteredAt,
      metadata: contact.metadata,
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      agentBasePrompt: tenant.agentBasePrompt,
      guardrailRules: tenant.guardrailRules,
      maxPixAmount: tenant.maxPixAmount,
    },
    stage: stage
      ? {
          id: stage.id,
          name: stage.name,
          funnelId: stage.funnelId,
          order: stage.order,
          isTerminal: stage.isTerminal,
          agentConfig: stage.agentConfig
            ? {
                funnelAgentName: stage.agentConfig.funnelAgentName,
                funnelAgentPersonality: stage.agentConfig.funnelAgentPersonality,
                stageContext: stage.agentConfig.stageContext,
                allowedTools: stage.agentConfig.allowedTools,
                model: stage.agentConfig.model,
                temperature: stage.agentConfig.temperature,
              }
            : null,
        }
      : null,
    funnel: funnel
      ? { id: funnel.id, name: funnel.name, description: funnel.description }
      : null,
    funnelStages: funnel?.stages
      ? funnel.stages.map((s) => ({ id: s.id, name: s.name, order: s.order }))
      : [],
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      type: m.type,
      createdAt: m.createdAt,
    })),
    nextAppointment: nextAppointment
      ? ({
          id: nextAppointment.id,
          scheduledAt: nextAppointment.scheduledAt,
          durationMin: nextAppointment.durationMin,
          status: nextAppointment.status,
          professional: nextAppointment.professional,
          service: nextAppointment.service,
        } as ContextAppointment)
      : null,
    pendingCharge: pendingCharge
      ? ({
          id: pendingCharge.id,
          amount: pendingCharge.amount,
          description: pendingCharge.description,
          status: pendingCharge.status,
          pixCopyPaste: pendingCharge.pixCopyPaste,
          dueAt: pendingCharge.dueAt,
        } as ContextCharge)
      : null,
    availableProfessionals,
    availableServices: servicesRaw.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      price: s.price,
    })),
    memories,
    asaasIntegration,
    zapiIntegration,
  }
}
