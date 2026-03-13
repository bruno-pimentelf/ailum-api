import type { FastifyInstance } from 'fastify'
import { Prisma } from '../../generated/prisma/client.js'
import { env } from '../../config/env.js'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'
import { getZapiConfig, sendText } from '../../services/zapi.service.js'
import { triggerQueue } from '../../jobs/queues.js'

// ─── Asaas webhook payload types ─────────────────────────────────────────────

interface AsaasPayment {
  id: string
  customer: string
  value: number
  netValue?: number
  billingType: string
  status: string
  dueDate: string
  paymentDate?: string
  description?: string
  externalReference?: string
}

interface AsaasWebhookPayload {
  event: string
  payment: AsaasPayment
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function asaasWebhookRoutes(fastify: FastifyInstance) {
  fastify.post('/asaas', async (request, reply) => {
    // Always respond 200 so Asaas does not retry
    reply.status(200).send({ ok: true })

    const token = request.headers['asaas-access-token'] as string | undefined
    if (token !== env.ASAAS_WEBHOOK_TOKEN) {
      fastify.log.warn({ ip: request.ip }, 'asaas:webhook:invalid_token')
      return
    }

    const { event, payment } = request.body as AsaasWebhookPayload

    if (!payment?.id) {
      fastify.log.warn({ event }, 'asaas:webhook:missing_payment')
      return
    }

    fastify.log.info({ event, paymentId: payment.id }, 'asaas:webhook:received')

    const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)

    // Find charge in our DB
    const charge = await fastify.db.charge.findFirst({
      where: { asaasPaymentId: payment.id },
      include: { contact: true },
    })

    if (!charge) {
      fastify.log.warn({ paymentId: payment.id }, 'asaas:webhook:charge_not_found')
      return
    }

    const { tenantId, contact } = charge

    switch (event) {
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED': {
        const paidAt = new Date()

        // Update charge
        let updatedCharge = await fastify.db.charge.update({
          where: { id: charge.id },
          data: { status: 'PAID', paidAt },
        })

        // PIX-antes: criar appointment após pagamento
        const pending = charge.pendingAppointment as
          | { scheduledAt: string; professionalId: string; serviceId: string; durationMin: number }
          | null
        if (pending) {
          const scheduledAt = new Date(pending.scheduledAt)
          const conflictEnd = new Date(
            scheduledAt.getTime() + (pending.durationMin ?? 50) * 60_000,
          )
          const conflict = await fastify.db.appointment.findFirst({
            where: {
              professionalId: pending.professionalId,
              status: { in: ['PENDING', 'CONFIRMED'] },
              scheduledAt: { lt: conflictEnd },
              AND: [
                {
                  scheduledAt: {
                    gte: new Date(
                      scheduledAt.getTime() - (pending.durationMin ?? 50) * 60_000,
                    ),
                  },
                },
              ],
            },
          })
          if (!conflict) {
            const appointment = await fastify.db.appointment.create({
              data: {
                tenantId,
                contactId: contact.id,
                professionalId: pending.professionalId,
                serviceId: pending.serviceId,
                scheduledAt,
                durationMin: pending.durationMin ?? 50,
                notes: null,
                status: 'CONFIRMED',
                createdBy: 'asaas_webhook',
              },
            })
            updatedCharge = await fastify.db.charge.update({
              where: { id: charge.id },
              data: { appointmentId: appointment.id, pendingAppointment: Prisma.JsonNull },
            })
            await sync.syncAppointment(tenantId, {
              id: appointment.id,
              contactId: appointment.contactId,
              professionalId: appointment.professionalId,
              serviceId: appointment.serviceId,
              scheduledAt: appointment.scheduledAt,
              durationMin: appointment.durationMin,
              status: appointment.status,
              notes: appointment.notes,
            })
          } else {
            fastify.log.warn(
              { chargeId: charge.id, pending },
              'asaas:webhook:slot_taken_after_payment',
            )
          }
        }

        // Se charge já estava linkada a appointment (fluxo normal), confirmar
        if (charge.appointmentId && !pending) {
          const updatedAppt = await fastify.db.appointment.update({
            where: { id: charge.appointmentId },
            data: { status: 'CONFIRMED' },
          })

          await sync.syncAppointment(tenantId, {
            id: updatedAppt.id,
            contactId: updatedAppt.contactId,
            professionalId: updatedAppt.professionalId,
            serviceId: updatedAppt.serviceId,
            scheduledAt: updatedAppt.scheduledAt,
            durationMin: updatedAppt.durationMin,
            status: updatedAppt.status,
            notes: updatedAppt.notes,
          })
        }

        // Mover para Consulta Agendada se existir
        const stages = await fastify.db.stage.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        })
        const consultaStage = stages.find(
          (s) =>
            s.name.toLowerCase().includes('consulta') && s.name.toLowerCase().includes('agendad'),
        )

        await fastify.db.contact.update({
          where: { id: contact.id },
          data: {
            status: 'PAYMENT_CONFIRMED',
            lastPaymentStatus: 'paid',
            ...(consultaStage && {
              currentStageId: consultaStage.id,
              stageEnteredAt: new Date(),
            }),
            updatedAt: new Date(),
          },
        })

        // Sync charge + contact to Firestore
        await sync.syncCharge(tenantId, {
          id: updatedCharge.id,
          contactId: updatedCharge.contactId,
          amount: updatedCharge.amount,
          description: updatedCharge.description,
          status: updatedCharge.status,
          pixCopyPaste: updatedCharge.pixCopyPaste,
          dueAt: updatedCharge.dueAt,
          paidAt: updatedCharge.paidAt,
        })

        await sync.updateContactPresence({
          tenantId,
          contactId: contact.id,
          status: 'PAYMENT_CONFIRMED',
          stageId: consultaStage?.id ?? contact.currentStageId,
          lastMessageAt: new Date(),
        })

        // Send confirmation message via Z-API
        const zapiConfig = await getZapiConfig(tenantId, fastify.db)
        if (zapiConfig) {
          const confirmationMsg = `✅ Pagamento confirmado! Seu agendamento está garantido. Até breve! 😊`

          await sendText(
            zapiConfig.instanceId,
            zapiConfig.clientToken,
            contact.phone,
            confirmationMsg,
          ).catch((err) =>
            fastify.log.error({ err }, 'asaas:webhook:send_confirmation:error'),
          )

          // Save confirmation message to DB
          const savedMessage = await fastify.db.message.create({
            data: {
              tenantId,
              contactId: contact.id,
              role: 'AGENT',
              type: 'TEXT',
              content: confirmationMsg,
              metadata: { source: 'asaas_webhook', event },
            },
          })

          await sync.syncMessage({
            tenantId,
            contactId: contact.id,
            messageId: savedMessage.id,
            role: 'AGENT',
            type: 'TEXT',
            content: confirmationMsg,
            createdAt: savedMessage.createdAt,
          })
        }

        fastify.log.info({ chargeId: charge.id, contactId: contact.id }, 'asaas:webhook:payment_confirmed')
        break
      }

      case 'PAYMENT_OVERDUE': {
        await fastify.db.charge.update({
          where: { id: charge.id },
          data: { status: 'OVERDUE' },
        })

        await sync.syncCharge(tenantId, {
          id: charge.id,
          contactId: charge.contactId,
          amount: charge.amount,
          description: charge.description,
          status: 'OVERDUE',
          pixCopyPaste: charge.pixCopyPaste,
          dueAt: charge.dueAt,
          paidAt: null,
        })

        // Enqueue a delayed retry job (1 hour)
        await triggerQueue.add(
          'payment-overdue-followup',
          {
            tenantId,
            contactId: contact.id,
            chargeId: charge.id,
          },
          { delay: 60 * 60 * 1000 },
        )

        fastify.log.info({ chargeId: charge.id }, 'asaas:webhook:payment_overdue')
        break
      }

      case 'PAYMENT_REFUNDED': {
        await fastify.db.charge.update({
          where: { id: charge.id },
          data: { status: 'REFUNDED' },
        })

        await sync.syncCharge(tenantId, {
          id: charge.id,
          contactId: charge.contactId,
          amount: charge.amount,
          description: charge.description,
          status: 'REFUNDED',
          pixCopyPaste: charge.pixCopyPaste,
          dueAt: charge.dueAt,
          paidAt: null,
        })

        fastify.log.info({ chargeId: charge.id }, 'asaas:webhook:payment_refunded')
        break
      }

      default:
        fastify.log.debug({ event }, 'asaas:webhook:unhandled_event')
    }
  })
}
