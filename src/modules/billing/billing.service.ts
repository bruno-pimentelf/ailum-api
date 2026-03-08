import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'
import { createPixCharge, cancelPayment } from '../../services/asaas.service.js'
import { decrypt } from '../../config/encryption.js'

export async function listCharges(
  db: PrismaClient,
  tenantId: string,
  query: {
    page?: number
    limit?: number
    contactId?: string
    status?: string
    from?: string
    to?: string
  },
) {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const skip = (page - 1) * limit

  const where = {
    tenantId,
    ...(query.contactId && { contactId: query.contactId }),
    ...(query.status && { status: query.status as never }),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lte: new Date(query.to + 'T23:59:59') }),
          },
        }
      : {}),
  }

  const [data, total] = await Promise.all([
    db.charge.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        appointment: { select: { id: true, scheduledAt: true } },
      },
    }),
    db.charge.count({ where }),
  ])

  return { data, total, page, limit, pages: Math.ceil(total / limit) }
}

export async function getChargeById(
  db: PrismaClient,
  tenantId: string,
  id: string,
) {
  return db.charge.findFirst({
    where: { id, tenantId },
    include: {
      contact: { select: { id: true, name: true, phone: true } },
      appointment: true,
    },
  })
}

export async function createManualCharge(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  body: {
    contactId: string
    appointmentId?: string
    amount: number
    description: string
    dueHours?: number
  },
) {
  const contact = await db.contact.findFirst({
    where: { id: body.contactId, tenantId },
  })
  if (!contact) throw fastify.httpErrors.notFound('Contact not found')

  // Check for existing pending charge (idempotency)
  const existing = await db.charge.findFirst({
    where: { contactId: body.contactId, tenantId, status: 'PENDING' },
  })
  if (existing) {
    throw fastify.httpErrors.badRequest('Contact already has a pending charge. Cancel it first.')
  }

  // Get Asaas integration
  const integration = await db.tenantIntegration.findFirst({
    where: { tenantId, provider: 'asaas', isActive: true },
    select: { apiKeyEncrypted: true },
  })
  if (!integration?.apiKeyEncrypted) {
    throw fastify.httpErrors.badRequest('Asaas integration not configured for this tenant')
  }

  const apiKey = decrypt(integration.apiKeyEncrypted)
  const dueHours = body.dueHours ?? 24
  const dueDate = new Date(Date.now() + dueHours * 3_600_000).toISOString().split('T')[0]!

  const pix = await createPixCharge(apiKey, {
    contactName: contact.name ?? contact.phone,
    phone: contact.phone,
    email: contact.email ?? undefined,
    value: body.amount,
    description: body.description,
    dueDate,
    externalReference: contact.id,
  })

  const charge = await db.charge.create({
    data: {
      tenantId,
      contactId: body.contactId,
      appointmentId: body.appointmentId,
      asaasPaymentId: pix.id,
      amount: body.amount,
      description: body.description,
      pixCopyPaste: pix.payload,
      qrCodeBase64: pix.encodedImage,
      dueAt: new Date(pix.expirationDate),
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncCharge(tenantId, {
    id: charge.id,
    contactId: charge.contactId,
    amount: charge.amount,
    description: charge.description,
    status: charge.status,
    pixCopyPaste: charge.pixCopyPaste,
    dueAt: charge.dueAt,
    paidAt: null,
  })

  return charge
}

export async function cancelCharge(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  id: string,
) {
  const charge = await db.charge.findFirst({ where: { id, tenantId } })
  if (!charge) throw fastify.httpErrors.notFound('Charge not found')
  if (charge.status !== 'PENDING') {
    throw fastify.httpErrors.badRequest(`Cannot cancel a charge with status ${charge.status}`)
  }

  // Cancel on Asaas if we have a payment ID
  if (charge.asaasPaymentId) {
    const integration = await db.tenantIntegration.findFirst({
      where: { tenantId, provider: 'asaas', isActive: true },
      select: { apiKeyEncrypted: true },
    })
    if (integration?.apiKeyEncrypted) {
      const apiKey = decrypt(integration.apiKeyEncrypted)
      await cancelPayment(apiKey, charge.asaasPaymentId).catch((err) =>
        fastify.log.error({ err }, 'billing:cancelCharge:asaas_error'),
      )
    }
  }

  const updated = await db.charge.update({
    where: { id },
    data: { status: 'CANCELLED', updatedAt: new Date() },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncCharge(tenantId, {
    id: updated.id,
    contactId: updated.contactId,
    amount: updated.amount,
    description: updated.description,
    status: updated.status,
    pixCopyPaste: updated.pixCopyPaste,
    dueAt: updated.dueAt,
    paidAt: null,
  })

  return updated
}
