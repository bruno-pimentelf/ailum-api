import { Worker } from 'bullmq'
import Anthropic from '@anthropic-ai/sdk'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { triggerQueue } from './queues.js'
import { FirebaseSyncService } from '../services/firebase-sync.service.js'
import { getZapiConfig, sendText } from '../services/zapi.service.js'
import { createPixCharge } from '../services/asaas.service.js'
import { decrypt } from '../config/encryption.js'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

// ─── Condition checkers ───────────────────────────────────────────────────────

interface TriggerConditionConfig {
  intent?: string
  hoursBeforeAppointment?: number
}

interface TriggerActionConfig {
  message?: string
  stageId?: string
  useAI?: boolean
  amount?: number
  description?: string
  dueHours?: number
  delayMinutes?: number
}

function checkCondition(
  event: string,
  contact: {
    stageEnteredAt: Date | null
    lastMessageAt: Date | null
    lastDetectedIntent: string | null
    lastPaymentStatus: string | null
  },
  trigger: {
    event: string
    delayMinutes: number
    conditionConfig: unknown
  },
  nextAppointment: { scheduledAt: Date } | null,
): boolean {
  const now = Date.now()
  const condition = trigger.conditionConfig as TriggerConditionConfig | null

  switch (event) {
    case 'STAGE_ENTERED':
      if (!contact.stageEnteredAt) return false
      return now - contact.stageEnteredAt.getTime() < 2 * 60 * 1000 // within last 2 min

    case 'STALE_IN_STAGE': {
      const ref = contact.lastMessageAt ?? contact.stageEnteredAt
      if (!ref) return false
      const staleSince = now - ref.getTime()
      return staleSince >= trigger.delayMinutes * 60 * 1000
    }

    case 'PAYMENT_CONFIRMED':
      return contact.lastPaymentStatus === 'paid'

    case 'APPOINTMENT_APPROACHING': {
      if (!nextAppointment) return false
      const hoursAhead = condition?.hoursBeforeAppointment ?? 24
      const diff = nextAppointment.scheduledAt.getTime() - now
      const windowMs = 30 * 60 * 1000 // 30-min window
      const targetMs = hoursAhead * 3600 * 1000
      return diff > targetMs - windowMs && diff <= targetMs + windowMs
    }

    case 'AI_INTENT':
      return contact.lastDetectedIntent === condition?.intent

    case 'MESSAGE_RECEIVED':
      return true

    default:
      return false
  }
}

// ─── Template interpolation ───────────────────────────────────────────────────

function interpolateTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

async function personalizeWithAI(
  template: string,
  contactName: string | null,
  appointmentTime: string | null,
): Promise<string> {
  const prompt = `Personalize esta mensagem para WhatsApp para um paciente de clínica médica.
Nome do paciente: ${contactName ?? 'paciente'}
Próxima consulta: ${appointmentTime ?? 'não informada'}
Template: "${template}"

Retorne APENAS o texto final da mensagem, sem explicações, sem aspas.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    return text.trim() || template
  } catch {
    return template
  }
}

// ─── Action executors ─────────────────────────────────────────────────────────

async function executeSendMessage(
  actionConfig: TriggerActionConfig,
  contact: { id: string; tenantId: string; phone: string; name: string | null },
  nextAppointment: { scheduledAt: Date } | null,
  fastify: FastifyInstance,
) {
  const template = actionConfig.message ?? ''
  if (!template) return

  const ptBrOpts = { timeZone: 'America/Sao_Paulo' as const }
  const interpolated = interpolateTemplate(template, {
    name: contact.name ?? 'paciente',
    appointmentTime: nextAppointment
      ? nextAppointment.scheduledAt.toLocaleString('pt-BR', ptBrOpts)
      : null,
  })

  let finalMessage = interpolated
  if (actionConfig.useAI) {
    finalMessage = await personalizeWithAI(
      interpolated,
      contact.name,
      nextAppointment?.scheduledAt.toLocaleString('pt-BR', ptBrOpts) ?? null,
    )
  }

  const zapiConfig = await getZapiConfig(contact.tenantId, fastify.db)
  if (zapiConfig) {
    await sendText(zapiConfig.instanceId, zapiConfig.clientToken, contact.phone, finalMessage)
  }

  const saved = await fastify.db.message.create({
    data: {
      tenantId: contact.tenantId,
      contactId: contact.id,
      role: 'AGENT',
      type: 'TEXT',
      content: finalMessage,
      metadata: { source: 'trigger_engine' },
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncConversationMessage(contact.tenantId, contact.id, {
    id: saved.id,
    role: 'AGENT',
    type: 'TEXT',
    content: finalMessage,
    createdAt: saved.createdAt,
  })
}

async function executeMoveStage(
  actionConfig: TriggerActionConfig,
  contact: { id: string; tenantId: string },
  fastify: FastifyInstance,
) {
  if (!actionConfig.stageId) return

  const stage = await fastify.db.stage.findFirst({
    where: { id: actionConfig.stageId, tenantId: contact.tenantId },
  })
  if (!stage) return

  await fastify.db.contact.update({
    where: { id: contact.id },
    data: {
      currentStageId: stage.id,
      currentFunnelId: stage.funnelId,
      stageEnteredAt: new Date(),
      updatedAt: new Date(),
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.updateContactPresence({
    tenantId: contact.tenantId,
    contactId: contact.id,
    status: 'QUALIFIED',
    stageId: stage.id,
    lastMessageAt: null,
  })
}

async function executeGeneratePix(
  actionConfig: TriggerActionConfig,
  contact: { id: string; tenantId: string; phone: string; name: string | null },
  fastify: FastifyInstance,
) {
  const amount = actionConfig.amount
  const description = actionConfig.description
  if (!amount || !description) return

  // Get Asaas integration
  const integration = await fastify.db.tenantIntegration.findFirst({
    where: { tenantId: contact.tenantId, provider: 'asaas', isActive: true },
    select: { apiKeyEncrypted: true },
  })
  if (!integration?.apiKeyEncrypted) return

  const apiKey = decrypt(integration.apiKeyEncrypted)
  const dueHours = actionConfig.dueHours ?? 24
  const dueDate = new Date(Date.now() + dueHours * 3600 * 1000)
    .toISOString()
    .split('T')[0]!

  const pix = await createPixCharge(apiKey, {
    contactName: contact.name ?? contact.phone,
    value: amount,
    description,
    dueDate,
    externalReference: contact.id,
  })

  await fastify.db.charge.create({
    data: {
      tenantId: contact.tenantId,
      contactId: contact.id,
      asaasPaymentId: pix.id,
      amount,
      description,
      pixCopyPaste: pix.payload,
      qrCodeBase64: pix.encodedImage,
      dueAt: new Date(pix.expirationDate),
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.updateContactPresence({
    tenantId: contact.tenantId,
    contactId: contact.id,
    status: 'AWAITING_PAYMENT',
    stageId: null,
    lastMessageAt: new Date(),
  })
}

// ─── Main worker ──────────────────────────────────────────────────────────────

export function createTriggerWorker(fastify: FastifyInstance) {
  const worker = new Worker(
    'trigger',
    async (job) => {
      // This worker handles both:
      // 1. Repeatable scan job (no data — scans all tenants)
      // 2. Individual trigger execution jobs
      const data = job.data as {
        tenantId?: string
        contactId?: string
        triggerId?: string
        chargeId?: string
        event?: string
      }

      // ── Payment overdue follow-up (from Asaas webhook) ──────────────────────
      if (job.name === 'payment-overdue-followup' && data.chargeId) {
        const charge = await fastify.db.charge.findFirst({
          where: { id: data.chargeId },
          include: { contact: true },
        })
        if (!charge) return

        const zapiConfig = await getZapiConfig(charge.tenantId, fastify.db)
        if (zapiConfig) {
          const msg = `⚠️ Seu pagamento está vencido. Por favor, entre em contato para reagendar ou gerar uma nova cobrança.`
          await sendText(zapiConfig.instanceId, zapiConfig.clientToken, charge.contact.phone, msg).catch(() => {})
        }
        return
      }

      // ── Single-contact trigger check (STAGE_ENTERED etc) ─────────────────────
      if (job.name === 'trigger-contact' && data.tenantId && data.contactId) {
        const contact = await fastify.db.contact.findFirst({
          where: { id: data.contactId, tenantId: data.tenantId, isActive: true },
          select: {
            id: true, tenantId: true, phone: true, name: true, status: true,
            currentStageId: true, stageEnteredAt: true, lastMessageAt: true,
            lastDetectedIntent: true, lastPaymentStatus: true,
          },
        })
        if (contact?.currentStageId) {
          const triggers = await fastify.db.trigger.findMany({
            where: { stageId: contact.currentStageId, tenantId: data.tenantId, isActive: true },
          })
          const nextAppointment = await fastify.db.appointment.findFirst({
            where: {
              contactId: contact.id,
              tenantId: contact.tenantId,
              status: { in: ['PENDING', 'CONFIRMED'] },
              scheduledAt: { gt: new Date() },
            },
            orderBy: { scheduledAt: 'asc' },
            select: { scheduledAt: true },
          })
          for (const trigger of triggers) {
            const cooldownKey = `trigger_fired:${trigger.id}:${contact.id}`
            if (await fastify.redis.exists(cooldownKey)) continue
            const shouldFire = checkCondition(
              trigger.event,
              contact,
              { event: trigger.event, delayMinutes: trigger.delayMinutes, conditionConfig: trigger.conditionConfig },
              nextAppointment,
            )
            if (!shouldFire) continue
            await fastify.redis.set(cooldownKey, '1', 'EX', trigger.cooldownSeconds)
            const actionConfig = trigger.actionConfig as TriggerActionConfig
            try {
              switch (trigger.action) {
                case 'SEND_MESSAGE':
                  await executeSendMessage(actionConfig, contact, nextAppointment, fastify)
                  break
                case 'MOVE_STAGE':
                  await executeMoveStage(actionConfig, contact, fastify)
                  break
                default:
                  continue
              }
              await fastify.db.triggerExecution.create({
                data: {
                  triggerId: trigger.id,
                  contactId: contact.id,
                  tenantId: contact.tenantId,
                  result: { action: trigger.action, success: true },
                  aiGenerated: actionConfig.useAI ?? false,
                },
              })
              fastify.log.info(
                { triggerId: trigger.id, contactId: contact.id, action: trigger.action },
                'trigger-engine:fired',
              )
            } catch (err) {
              fastify.log.error({ err, triggerId: trigger.id, contactId: contact.id }, 'trigger-engine:action_error')
              await fastify.db.triggerExecution.create({
                data: {
                  triggerId: trigger.id,
                  contactId: contact.id,
                  tenantId: contact.tenantId,
                  result: { action: trigger.action, success: false, error: String(err) },
                },
              }).catch(() => {})
            }
          }
        }
        if (job.name === 'trigger-contact') return
      }

      // ── Repeatable full scan ────────────────────────────────────────────────
      const activeTenants = await fastify.db.tenant.findMany({
        where: { isActive: true },
        select: { id: true },
      })

      for (const tenant of activeTenants) {
        // Process in batches of 50 contacts
        let skip = 0
        const batchSize = 50

        while (true) {
          const contacts = await fastify.db.contact.findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
              currentStageId: { not: null },
              status: { notIn: ['NO_INTEREST', 'IN_HUMAN_SERVICE'] },
            },
            skip,
            take: batchSize,
            select: {
              id: true,
              tenantId: true,
              phone: true,
              name: true,
              status: true,
              currentStageId: true,
              stageEnteredAt: true,
              lastMessageAt: true,
              lastDetectedIntent: true,
              lastPaymentStatus: true,
            },
          })

          if (contacts.length === 0) break

          for (const contact of contacts) {
            if (!contact.currentStageId) continue

            // Get triggers for this stage
            const triggers = await fastify.db.trigger.findMany({
              where: { stageId: contact.currentStageId, tenantId: tenant.id, isActive: true },
            })

            // Get next appointment (PENDING ou CONFIRMED)
            const nextAppointment = await fastify.db.appointment.findFirst({
              where: {
                contactId: contact.id,
                tenantId: tenant.id,
                status: { in: ['PENDING', 'CONFIRMED'] },
                scheduledAt: { gt: new Date() },
              },
              orderBy: { scheduledAt: 'asc' },
              select: { scheduledAt: true },
            })

            for (const trigger of triggers) {
              const cooldownKey = `trigger_fired:${trigger.id}:${contact.id}`
              const alreadyFired = await fastify.redis.exists(cooldownKey)
              if (alreadyFired) continue

              const shouldFire = checkCondition(
                trigger.event,
                contact,
                {
                  event: trigger.event,
                  delayMinutes: trigger.delayMinutes,
                  conditionConfig: trigger.conditionConfig,
                },
                nextAppointment,
              )

              if (!shouldFire) continue

              // Set cooldown BEFORE executing to prevent concurrent duplicates
              await fastify.redis.set(cooldownKey, '1', 'EX', trigger.cooldownSeconds)

              const actionConfig = trigger.actionConfig as TriggerActionConfig

              try {
                switch (trigger.action) {
                  case 'SEND_MESSAGE':
                    await executeSendMessage(actionConfig, contact, nextAppointment, fastify)
                    break
                  case 'MOVE_STAGE':
                    await executeMoveStage(actionConfig, contact, fastify)
                    break
                  case 'GENERATE_PIX':
                    await executeGeneratePix(actionConfig, contact, fastify)
                    break
                  case 'NOTIFY_OPERATOR': {
                    const zapiConfig = await getZapiConfig(tenant.id, fastify.db)
                    if (zapiConfig) {
                      const msg = `🔔 Atenção: Contato ${contact.name ?? contact.phone} precisa de atendimento (trigger: ${trigger.event})`
                      await sendText(zapiConfig.instanceId, zapiConfig.clientToken, contact.phone, msg).catch(() => {})
                    }
                    break
                  }
                  case 'WAIT_AND_REPEAT':
                    await triggerQueue.add(
                      'trigger-repeat',
                      { tenantId: tenant.id, contactId: contact.id, triggerId: trigger.id },
                      { delay: (actionConfig.delayMinutes ?? 60) * 60 * 1000 },
                    )
                    break
                }

                // Log execution
                await fastify.db.triggerExecution.create({
                  data: {
                    triggerId: trigger.id,
                    contactId: contact.id,
                    tenantId: tenant.id,
                    result: { action: trigger.action, success: true },
                    aiGenerated: actionConfig.useAI ?? false,
                  },
                })

                fastify.log.info(
                  { triggerId: trigger.id, contactId: contact.id, action: trigger.action },
                  'trigger-engine:fired',
                )
              } catch (err) {
                fastify.log.error(
                  { err, triggerId: trigger.id, contactId: contact.id },
                  'trigger-engine:action_error',
                )
                // Log failed execution
                await fastify.db.triggerExecution.create({
                  data: {
                    triggerId: trigger.id,
                    contactId: contact.id,
                    tenantId: tenant.id,
                    result: { action: trigger.action, success: false, error: String(err) },
                  },
                }).catch(() => {})
              }
            }
          }

          skip += batchSize
          if (contacts.length < batchSize) break
        }
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 2,
    },
  )

  worker.on('failed', (job, err) => {
    fastify.log.error({ jobId: job?.id, err }, 'trigger-engine:job_failed')
  })

  return worker
}

// ─── Schedule repeatable scan every 60 seconds ───────────────────────────────

export async function scheduleTriggerScan() {
  await triggerQueue.add(
    'trigger-scan',
    {},
    {
      repeat: { every: 60_000 },
      jobId: 'trigger-scan-repeatable',
    },
  )
}
