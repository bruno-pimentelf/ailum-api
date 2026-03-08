import type { FastifyInstance } from 'fastify'
import {
  AppointmentParamsSchema,
  AvailabilityQuerySchema,
  CreateAppointmentSchema,
  ListAppointmentsQuerySchema,
  ProfessionalAvailabilityParamsSchema,
  UpdateAppointmentSchema,
} from './scheduling.schema.js'
import {
  cancelAppointment,
  createAppointment,
  getAppointmentById,
  getProfessionalAvailability,
  listAppointments,
  updateAppointment,
} from './scheduling.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function schedulingRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SCHEDULING_READ)],
      schema: { querystring: ListAppointmentsQuerySchema },
    },
    async (req) =>
      listAppointments(
        fastify.db,
        req.tenantId,
        req.query as never,
        req.role,
        req.professionalId,
      ),
  )

  fastify.get(
    '/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SCHEDULING_READ)],
      schema: { params: AppointmentParamsSchema },
    },
    async (req, reply) => {
      const appt = await getAppointmentById(fastify.db, req.tenantId, (req.params as { id: string }).id)
      if (!appt) return reply.notFound('Appointment not found')
      return appt
    },
  )

  fastify.post(
    '/',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SCHEDULING_WRITE)],
      schema: { body: CreateAppointmentSchema },
    },
    async (req, reply) => {
      const appt = await createAppointment(fastify.db, fastify, req.tenantId, req.memberId, req.body as never)
      req.log.info({ appointmentId: appt.id }, 'appointment:created')
      return reply.status(201).send(appt)
    },
  )

  fastify.patch(
    '/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SCHEDULING_WRITE)],
      schema: { params: AppointmentParamsSchema, body: UpdateAppointmentSchema },
    },
    async (req) =>
      updateAppointment(fastify.db, fastify, req.tenantId, (req.params as { id: string }).id, req.body as never),
  )

  fastify.delete(
    '/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SCHEDULING_WRITE)],
      schema: { params: AppointmentParamsSchema },
    },
    async (req) =>
      cancelAppointment(fastify.db, fastify, req.tenantId, (req.params as { id: string }).id),
  )

  // Availability for a specific professional
  fastify.get(
    '/professionals/:id/availability',
    {
      onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SCHEDULING_READ)],
      schema: { params: ProfessionalAvailabilityParamsSchema, querystring: AvailabilityQuerySchema },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const q = req.query as { date: string; serviceId: string }
      const result = await getProfessionalAvailability(fastify.db, req.tenantId, id, q.date, q.serviceId)
      if (!result) return reply.notFound('Professional not found')
      return result
    },
  )
}
