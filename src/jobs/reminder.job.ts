import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { reminderQueue } from './queues.js'
import { getZapiConfig, sendText } from '../services/zapi.service.js'
import { FirebaseSyncService } from '../services/firebase-sync.service.js'

type ReminderType = '24h' | '1h'

// Window boundaries (minutes)
const WINDOWS: Record<ReminderType, { minMin: number; maxMin: number }> = {
  '24h': { minMin: 23 * 60, maxMin: 25 * 60 },
  '1h': { minMin: 50, maxMin: 70 },
}

function redisKey(appointmentId: string, type: ReminderType): string {
  return `reminder_sent:${appointmentId}:${type}`
}

function buildReminderMessage(
  type: ReminderType,
  contact: { name: string | null },
  appointment: {
    scheduledAt: Date
    professional: { fullName: string }
    service: { name: string }
  },
): string {
  const name = contact.name ?? 'paciente'
  const dateStr = appointment.scheduledAt.toLocaleDateString('pt-BR')
  const timeStr = appointment.scheduledAt.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const professional = appointment.professional.fullName
  const service = appointment.service.name

  if (type === '24h') {
    return `Olá, ${name}! Lembrando que você tem uma consulta de ${service} amanhã (${dateStr}) às ${timeStr} com ${professional}. Confirma sua presença? Responda SIM para confirmar. 😊`
  }

  return `Olá, ${name}! Sua consulta de ${service} com ${professional} é HOJE às ${timeStr}. Estamos te esperando! 🏥`
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
          const key = redisKey(appt.id, type)
          const alreadySent = await fastify.redis.exists(key)
          if (alreadySent) continue

          const message = buildReminderMessage(type, appt.contact, appt)
          const zapiConfig = await getZapiConfig(appt.contact.tenantId, fastify.db)

          if (zapiConfig) {
            try {
              await sendText(
                zapiConfig.instanceId,
                zapiConfig.clientToken,
                appt.contact.phone,
                message,
              )

              // Save message to DB
              const saved = await fastify.db.message.create({
                data: {
                  tenantId: appt.contact.tenantId,
                  contactId: appt.contact.id,
                  role: 'AGENT',
                  type: 'TEXT',
                  content: message,
                  metadata: { source: 'reminder', reminderType: type, appointmentId: appt.id },
                },
              })

              const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
              await sync.syncConversationMessage(appt.contact.tenantId, appt.contact.id, {
                id: saved.id,
                role: 'AGENT',
                type: 'TEXT',
                content: message,
                createdAt: saved.createdAt,
              })

              // Mark as sent in Redis with 2h TTL to prevent duplicates
              await fastify.redis.set(key, '1', 'EX', 2 * 3600)

              fastify.log.info(
                { appointmentId: appt.id, type, contactId: appt.contact.id },
                'reminder-job:sent',
              )
            } catch (err) {
              fastify.log.error({ err, appointmentId: appt.id }, 'reminder-job:send_error')
            }
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
