import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { reminderQueue } from './queues.js'
import { getTemplateByKey } from '../modules/templates/templates.service.js'
import { sendTemplateMessage } from '../services/template-send.service.js'
import { getZapiConfig, sendText } from '../services/zapi.service.js'
import { FirebaseSyncService } from '../services/firebase-sync.service.js'

type ReminderType = '24h' | '1h'

const REMINDER_TEMPLATE_KEYS: Record<ReminderType, string> = {
  '24h': 'reminder_24h',
  '1h': 'reminder_1h',
}

// Window boundaries (minutes)
const WINDOWS: Record<ReminderType, { minMin: number; maxMin: number }> = {
  '24h': { minMin: 23 * 60, maxMin: 25 * 60 },
  '1h': { minMin: 50, maxMin: 70 },
}

function redisKey(appointmentId: string, type: ReminderType): string {
  return `reminder_sent:${appointmentId}:${type}`
}

function buildDefaultReminderContext(
  type: ReminderType,
  contact: { name: string | null },
  appointment: {
    scheduledAt: Date
    professional: { fullName: string }
    service: { name: string }
  },
): { body: string } {
  const name = contact.name ?? 'paciente'
  const tz = 'America/Sao_Paulo'
  const dateStr = appointment.scheduledAt.toLocaleDateString('pt-BR', { timeZone: tz })
  const timeStr = appointment.scheduledAt.toLocaleTimeString('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  })
  const professional = appointment.professional.fullName
  const service = appointment.service.name

  if (type === '24h') {
    return {
      body: `Olá, ${name}! Lembrando que você tem uma consulta de ${service} amanhã (${dateStr}) às ${timeStr} com ${professional}. Confirma sua presença? Responda SIM para confirmar. 😊`,
    }
  }
  return {
    body: `Olá, ${name}! Sua consulta de ${service} com ${professional} é HOJE às ${timeStr}. Estamos te esperando! 🏥`,
  }
}

export function createReminderWorker(fastify: FastifyInstance) {
  const worker = new Worker(
    'reminder',
    async (job) => {
      const now = new Date()

      for (const [type, window] of Object.entries(WINDOWS) as [
        ReminderType,
        { minMin: number; maxMin: number },
      ][]) {
        const minFuture = new Date(now.getTime() + window.minMin * 60_000)
        const maxFuture = new Date(now.getTime() + window.maxMin * 60_000)

        const appointments = await fastify.db.appointment.findMany({
          where: {
            status: 'CONFIRMED',
            scheduledAt: { gte: minFuture, lte: maxFuture },
          },
          include: {
            contact: { select: { id: true, tenantId: true, phone: true, name: true } },
            professional: { select: { fullName: true } },
            service: { select: { name: true } },
          },
        })

        fastify.log.debug(
          { type, count: appointments.length },
          `reminder-job:found_appointments`,
        )

        for (const appt of appointments) {
          const redisKeyVal = redisKey(appt.id, type)
          const alreadySent = await fastify.redis.exists(redisKeyVal)
          if (alreadySent) continue

          const tz = 'America/Sao_Paulo'
          const ptBrOpts = { timeZone: tz } as const
          const context = {
            name: appt.contact.name ?? 'paciente',
            appointmentTime: appt.scheduledAt.toLocaleString('pt-BR', ptBrOpts),
            appointmentDate: appt.scheduledAt.toLocaleDateString('pt-BR', ptBrOpts),
            appointmentTimeOnly: appt.scheduledAt.toLocaleTimeString('pt-BR', {
              ...ptBrOpts,
              hour: '2-digit',
              minute: '2-digit',
            }),
            professionalName: appt.professional.fullName,
            serviceName: appt.service.name,
          }

          const templateKey = REMINDER_TEMPLATE_KEYS[type]
          const template = await getTemplateByKey(fastify.db, appt.contact.tenantId, templateKey)

          try {
            if (template) {
              await sendTemplateMessage(
                fastify.db,
                fastify.firebase.firestore,
                fastify.log,
                appt.contact.tenantId,
                appt.contact.id,
                appt.contact.phone,
                template,
                context,
                { source: 'reminder', reminderType: type, appointmentId: appt.id },
              )
            } else {
              const { body } = buildDefaultReminderContext(type, appt.contact, appt)
              const zapiConfig = await getZapiConfig(appt.contact.tenantId, fastify.db)
              const isPlayground = appt.contact.phone === '__playground__'

              if (zapiConfig && !isPlayground) {
                await sendText(
                  zapiConfig.instanceId,
                  zapiConfig.clientToken,
                  appt.contact.phone,
                  body,
                )
              }

              const saved = await fastify.db.message.create({
                data: {
                  tenantId: appt.contact.tenantId,
                  contactId: appt.contact.id,
                  role: 'AGENT',
                  type: 'TEXT',
                  content: body,
                  metadata: { source: 'reminder', reminderType: type, appointmentId: appt.id },
                },
              })

              const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
              await sync.syncConversationMessage(appt.contact.tenantId, appt.contact.id, {
                id: saved.id,
                role: 'AGENT',
                type: 'TEXT',
                content: body,
                createdAt: saved.createdAt,
              })
            }

            await fastify.redis.set(redisKeyVal, '1', 'EX', 2 * 3600)
            fastify.log.info(
              { appointmentId: appt.id, type, contactId: appt.contact.id },
              'reminder-job:sent',
            )
          } catch (err) {
            fastify.log.error({ err, appointmentId: appt.id }, 'reminder-job:send_error')
          }
        }
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 1,
    },
  )

  worker.on('failed', (job, err) => {
    fastify.log.error({ jobId: job?.id, err }, 'reminder-job:failed')
  })

  return worker
}

// ─── Schedule repeatable scan every 30 minutes ───────────────────────────────

export async function scheduleReminderScan() {
  await reminderQueue.add(
    'reminder-scan',
    {},
    {
      repeat: { every: 30 * 60_000 },
      jobId: 'reminder-scan-repeatable',
    },
  )
}
