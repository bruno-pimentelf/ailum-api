import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  ProfessionalParamsSchema, ExceptionDateParamsSchema, ServiceAssocParamsSchema,
  CreateProfessionalSchema, UpdateProfessionalSchema,
  SetAvailabilitySchema, AddExceptionSchema, AddOverrideSchema, AddBlockRangeSchema,
  OverrideIdParamsSchema, BlockRangeIdParamsSchema, AssociateServiceSchema,
} from './professionals.schema.js'
import {
  listProfessionals, getProfessionalById, createProfessional, updateProfessional, deactivateProfessional,
  getProfessionalAvailabilitySchedule, setProfessionalAvailability, clearProfessionalAvailability,
  addAvailabilityException, removeAvailabilityException,
  addAvailabilityOverride, listAvailabilityOverrides, removeAvailabilityOverride,
  addAvailabilityBlockRange, listAvailabilityBlockRanges, removeAvailabilityBlockRange,
  associateProfessionalService, disassociateProfessionalService,
} from './professionals.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function professionalsRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_READ)],
  }, async (req) => listProfessionals(fastify.db, req.tenantId))

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_READ)],
    schema: { params: ProfessionalParamsSchema },
  }, async (req, reply) => {
    const p = await getProfessionalById(fastify.db, req.tenantId, (req.params as { id: string }).id)
    if (!p) return reply.notFound('Professional not found')
    return p
  })

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { body: CreateProfessionalSchema },
  }, async (req, reply) => reply.status(201).send(await createProfessional(fastify.db, req.tenantId, req.body as never)))

  fastify.patch('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { params: ProfessionalParamsSchema, body: UpdateProfessionalSchema },
  }, async (req) => updateProfessional(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { params: ProfessionalParamsSchema },
  }, async (req) => deactivateProfessional(fastify.db, req.tenantId, (req.params as { id: string }).id))

  // ── Availability ────────────────────────────────────────────────────────────
  fastify.get('/:id/availability', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_READ)],
    schema: { params: ProfessionalParamsSchema },
  }, async (req) => getProfessionalAvailabilitySchedule(fastify.db, req.tenantId, (req.params as { id: string }).id))

  fastify.put('/:id/availability', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: ProfessionalParamsSchema, body: SetAvailabilitySchema },
  }, async (req) => setProfessionalAvailability(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/:id/availability', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: ProfessionalParamsSchema },
  }, async (req) => clearProfessionalAvailability(fastify.db, req.tenantId, (req.params as { id: string }).id))

  // ── Exceptions ──────────────────────────────────────────────────────────────
  fastify.post('/:id/exceptions', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: ProfessionalParamsSchema, body: AddExceptionSchema },
  }, async (req, reply) => {
    const body = req.body as { date: string; isUnavailable?: boolean; reason?: string; slotMask?: Array<{ startTime: string; endTime: string }> }
    if (body.isUnavailable !== false && body.slotMask && body.slotMask.length > 0) {
      throw fastify.httpErrors.badRequest('slotMask só é permitido quando isUnavailable=false')
    }
    return reply.status(201).send(await addAvailabilityException(fastify.db, req.tenantId, (req.params as { id: string }).id, body))
  })

  fastify.delete('/:id/exceptions/:date', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: ExceptionDateParamsSchema },
  }, async (req) => {
    const { id, date } = req.params as { id: string; date: string }
    return removeAvailabilityException(fastify.db, req.tenantId, id, date)
  })

  // ── Overrides (disponibilidade em data específica) ──────────────────────────
  fastify.post('/:id/overrides', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: ProfessionalParamsSchema, body: AddOverrideSchema },
  }, async (req, reply) =>
    reply.status(201).send(await addAvailabilityOverride(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never)))

  fastify.get('/:id/overrides', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_READ)],
    schema: {
      params: ProfessionalParamsSchema,
      querystring: Type.Object({
        from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
        to: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
      }),
    },
  }, async (req) => {
    const { id } = req.params as { id: string }
    const q = req.query as { from?: string; to?: string }
    return listAvailabilityOverrides(fastify.db, req.tenantId, id, { from: q.from, to: q.to })
  })

  fastify.delete('/:id/overrides/:overrideId', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: OverrideIdParamsSchema },
  }, async (req) => {
    const { id, overrideId } = req.params as { id: string; overrideId: string }
    return removeAvailabilityOverride(fastify.db, req.tenantId, id, overrideId)
  })

  // ── Block ranges (bloqueio de intervalo de datas) ───────────────────────────
  fastify.post('/:id/block-ranges', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: ProfessionalParamsSchema, body: AddBlockRangeSchema },
  }, async (req, reply) => {
    const body = req.body as { dateFrom: string; dateTo: string; reason?: string }
    if (body.dateTo < body.dateFrom) {
      throw fastify.httpErrors.badRequest('dateTo deve ser maior ou igual a dateFrom')
    }
    return reply.status(201).send(await addAvailabilityBlockRange(fastify.db, req.tenantId, (req.params as { id: string }).id, body))
  })

  fastify.get('/:id/block-ranges', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_READ)],
    schema: { params: ProfessionalParamsSchema },
  }, async (req) => listAvailabilityBlockRanges(fastify.db, req.tenantId, (req.params as { id: string }).id))

  fastify.delete('/:id/block-ranges/:blockRangeId', {
    onRequest: [
      fastify.authenticate,
      fastify.authorizeProfessionalWrite((req) => (req.params as { id: string }).id),
    ],
    schema: { params: BlockRangeIdParamsSchema },
  }, async (req) => {
    const { id, blockRangeId } = req.params as { id: string; blockRangeId: string }
    return removeAvailabilityBlockRange(fastify.db, req.tenantId, id, blockRangeId)
  })

  // ── Services ────────────────────────────────────────────────────────────────
  fastify.post('/:id/services/:serviceId', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { params: ServiceAssocParamsSchema, body: AssociateServiceSchema },
  }, async (req, reply) => {
    const { id, serviceId } = req.params as { id: string; serviceId: string }
    const { customPrice } = req.body as { customPrice?: number }
    return reply.status(201).send(await associateProfessionalService(fastify.db, req.tenantId, id, serviceId, customPrice))
  })

  fastify.delete('/:id/services/:serviceId', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { params: ServiceAssocParamsSchema },
  }, async (req) => {
    const { id, serviceId } = req.params as { id: string; serviceId: string }
    return disassociateProfessionalService(fastify.db, req.tenantId, id, serviceId)
  })
}
