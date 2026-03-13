import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { getZapiConfig, sendText } from '../services/zapi.service.js'

export interface SlotRecallJobData {
  tenantId: string
  professionalId: string
  professionalName: string
  scheduledAt: string
  serviceName: string
  excludeContactId: string
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function professionalNameMatches(preferred: string, actual: string): boolean {
  const p = normalizeForMatch(preferred)
  const a = normalizeForMatch(actual)
  if (!p || p === 'qualquer' || p === 'any' || p === 'true') return true
  return a.includes(p) || p.includes(a)
}

export function createSlotRecallWorker(fastify: FastifyInstance) {
  const worker = new Worker<SlotRecallJobData>(
    'slot-recall',
    async (job) => {
      const { tenantId, professionalName, scheduledAt, serviceName, excludeContactId } = job.data

      const zapi = await getZapiConfig(tenantId, fastify.db)
      if (!zapi) {
        job.log('Z-API not configured, skipping slot recall')
        return
      }

      const slotDate = new Date(scheduledAt)
      const dateStr = slotDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      const timeStr = slotDate.toLocaleTimeString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      })

      const contactsWithRecall = await fastify.db.agentMemory.findMany({
        where: {
          tenantId,
          key: 'wants_slot_on_cancellation',
          contactId: { not: excludeContactId },
          contact: {
            isActive: true,
            phone: { not: '__playground__' },
            status: { not: 'ATTENDED' },
          },
        },
        select: {
          contactId: true,
          contact: { select: { phone: true, name: true } },
        },
      })

      if (contactsWithRecall.length === 0) {
        job.log('No contacts with wants_slot_on_cancellation')
        return
      }

      let sent = 0
      for (const { contactId, contact } of contactsWithRecall) {
        const preferredMem = await fastify.db.agentMemory.findUnique({
          where: { contactId_key: { contactId, key: 'preferred_professional' } },
          select: { value: true },
        })
        if (preferredMem && !professionalNameMatches(preferredMem.value, professionalName)) {
          job.log(`Skipping contact ${contactId}: preferred_professional "${preferredMem.value}" does not match "${professionalName}"`)
          continue
        }

        const name = contact.name ?? 'paciente'
        const msg = `Olá, ${name}! 😊 Abriu uma vaga com ${professionalName} no dia ${dateStr} às ${timeStr} (${serviceName}). Quer agendar? É só responder aqui que te ajudo!`

        try {
          await sendText(zapi.instanceId, zapi.clientToken, contact.phone, msg)
          sent++
          job.log(`Sent recall to ${contact.phone}`)
        } catch (err) {
          fastify.log.warn({ err, contactId }, 'slot-recall:send_error')
        }
      }

      job.log(`Slot recall complete: ${sent}/${contactsWithRecall.length} messages sent`)
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 2,
    },
  )

  worker.on('failed', (job, err) => {
    fastify.log.error({ jobId: job?.id, err }, 'slot-recall:failed')
  })

  return worker
}
