import type { FastifyInstance } from 'fastify'
import { ChargeParamsSchema, CreateChargeSchema, ListChargesQuerySchema } from './billing.schema.js'
import { cancelCharge, createManualCharge, getChargeById, listCharges } from './billing.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.BILLING_READ)],
      schema: { querystring: ListChargesQuerySchema },
    },
    async (req) => listCharges(fastify.db, req.tenantId, req.query as never),
  )

  fastify.get(
    '/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.BILLING_READ)],
      schema: { params: ChargeParamsSchema },
    },
    async (req, reply) => {
      const charge = await getChargeById(fastify.db, req.tenantId, (req.params as { id: string }).id)
      if (!charge) return reply.notFound('Charge not found')
      return charge
    },
  )

  fastify.post(
    '/',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.BILLING_WRITE)],
      schema: { body: CreateChargeSchema },
    },
    async (req, reply) => {
      const charge = await createManualCharge(fastify.db, fastify, req.tenantId, req.body as never)
      req.log.info({ chargeId: charge.id }, 'charge:created')
      return reply.status(201).send(charge)
    },
  )

  fastify.post(
    '/:id/cancel',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.BILLING_WRITE)],
      schema: { params: ChargeParamsSchema },
    },
    async (req) => {
      const charge = await cancelCharge(fastify.db, fastify, req.tenantId, (req.params as { id: string }).id)
      req.log.info({ chargeId: charge.id }, 'charge:cancelled')
      return charge
    },
  )
}
