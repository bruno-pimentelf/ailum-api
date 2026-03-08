import { Worker } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { env } from '../config/env.js'
import { pixExpireQueue } from './queues.js'
import { FirebaseSyncService } from '../services/firebase-sync.service.js'
import { getZapiConfig, sendText } from '../services/zapi.service.js'

export function createPixExpireWorker(fastify: FastifyInstance) {
  const worker = new Worker(
    'pix-expire',
    async (job) => {
      const now = new Date()

      // Find all PENDING charges past their due date
      const overdueCharges = await fastify.db.charge.findMany({
        where: {
          status: 'PENDING',
          dueAt: { lt: now },
        },
        include: {
          contact: { select: { id: true, tenantId: true, phone: true, name: true } },
        },
        take: 100,
      })

      fastify.log.debug(
        { count: overdueCharges.length },
        'pix-expire-job:found_overdue',
      )

      const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)

      for (const charge of overdueCharges) {
        try {
          // Update to OVERDUE in Postgres
          const updated = await fastify.db.charge.update({
            where: { id: charge.id },
            data: { status: 'OVERDUE' },
          })

          // Sync to Firestore
          await sync.syncCharge(charge.contact.tenantId, {
            id: updated.id,
            contactId: updated.contactId,
            amount: updated.amount,
            description: updated.description,
            status: updated.status,
            pixCopyPaste: updated.pixCopyPaste,
            dueAt: updated.dueAt,
            paidAt: null,
          })

          // Send expiry notification via WhatsApp
          const zapiConfig = await getZapiConfig(charge.contact.tenantId, fastify.db)
          if (zapiConfig) {
            const contactName = charge.contact.name ?? 'paciente'
            const msg = `Olá, ${contactName}! O seu PIX de R$ ${charge.amount} (${charge.description}) venceu. Deseja gerar uma nova cobrança? Entre em contato conosco! 😊`

            try {
              await sendText(
                zapiConfig.instanceId,
                zapiConfig.clientToken,
                charge.contact.phone,
                msg,
              )

              const saved = await fastify.db.message.create({
                data: {
                  tenantId: charge.contact.tenantId,
                  contactId: charge.contact.id,
                  role: 'AGENT',
                  type: 'TEXT',
                  content: msg,
                  metadata: { source: 'pix_expire', chargeId: charge.id },
                },
              })

              await sync.syncConversationMessage(charge.contact.tenantId, charge.contact.id, {
                id: saved.id,
                role: 'AGENT',
                type: 'TEXT',
                content: msg,
                createdAt: saved.createdAt,
              })
            } catch (sendErr) {
              fastify.log.error({ sendErr, chargeId: charge.id }, 'pix-expire-job:send_error')
            }
          }

          fastify.log.info(
            { chargeId: charge.id, contactId: charge.contact.id },
            'pix-expire-job:marked_overdue',
          )
        } catch (err) {
          fastify.log.error({ err, chargeId: charge.id }, 'pix-expire-job:error')
        }
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 1,
    },
  )

  worker.on('failed', (job, err) => {
    fastify.log.error({ jobId: job?.id, err }, 'pix-expire-job:failed')
  })

  return worker
}

// ─── Schedule repeatable scan every 5 minutes ────────────────────────────────

export async function schedulePixExpireScan() {
  await pixExpireQueue.add(
    'pix-expire-scan',
    {},
    {
      repeat: { every: 5 * 60_000 },
      jobId: 'pix-expire-scan-repeatable',
    },
  )
}
