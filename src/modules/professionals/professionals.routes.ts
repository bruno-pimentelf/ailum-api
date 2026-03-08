import type { FastifyInstance } from 'fastify'
import {
  ProfessionalParamsSchema, ExceptionDateParamsSchema, ServiceAssocParamsSchema,
  CreateProfessionalSchema, UpdateProfessionalSchema,
  SetAvailabilitySchema, AddExceptionSchema, AssociateServiceSchema,
} from './professionals.schema.js'
import {
  listProfessionals, getProfessionalById, createProfessional, updateProfessional, deactivateProfessional,
  getProfessionalAvailabilitySchedule, setProfessionalAvailability,
  addAvailabilityException, removeAvailabilityException,
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
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { params: ProfessionalParamsSchema, body: SetAvailabilitySchema },
  }, async (req) => setProfessionalAvailability(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  // ── Exceptions ──────────────────────────────────────────────────────────────
  fastify.post('/:id/exceptions', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { params: ProfessionalParamsSchema, body: AddExceptionSchema },
  }, async (req, reply) => reply.status(201).send(await addAvailabilityException(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never)))

  fastify.delete('/:id/exceptions/:date', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.PROFESSIONALS_WRITE)],
    schema: { params: ExceptionDateParamsSchema },
  }, async (req) => {
    const { id, date } = req.params as { id: string; date: string }
    return removeAvailabilityException(fastify.db, req.tenantId, id, date)
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
