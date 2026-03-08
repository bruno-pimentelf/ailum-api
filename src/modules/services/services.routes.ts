import type { FastifyInstance } from 'fastify'
import { ServiceParamsSchema, CreateServiceSchema, UpdateServiceSchema } from './services.schema.js'
import { listServices, getServiceById, createService, updateService, deactivateService } from './services.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function servicesRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SERVICES_READ)],
  }, async (req) => listServices(fastify.db, req.tenantId))

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SERVICES_READ)],
    schema: { params: ServiceParamsSchema },
  }, async (req, reply) => {
    const service = await getServiceById(fastify.db, req.tenantId, (req.params as { id: string }).id)
    if (!service) return reply.notFound('Service not found')
    return service
  })

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SERVICES_WRITE)],
    schema: { body: CreateServiceSchema },
  }, async (req, reply) => reply.status(201).send(await createService(fastify.db, req.tenantId, req.body as never)))

  fastify.patch('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SERVICES_WRITE)],
    schema: { params: ServiceParamsSchema, body: UpdateServiceSchema },
  }, async (req) => updateService(fastify.db, req.tenantId, (req.params as { id: string }).id, req.body as never))

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.SERVICES_WRITE)],
    schema: { params: ServiceParamsSchema },
  }, async (req) => deactivateService(fastify.db, req.tenantId, (req.params as { id: string }).id))
}
