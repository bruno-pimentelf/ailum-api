import type { FastifyInstance } from 'fastify'
import { UpdateTenantSchema } from './tenant.schema.js'
import { getTenant, updateTenant } from './tenant.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function tenantRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate],
  }, async (req, reply) => {
    const tenant = await getTenant(fastify.db, req.tenantId)
    if (!tenant) return reply.notFound('Tenant not found')
    return tenant
  })

  fastify.patch('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_SETTINGS_WRITE)],
    schema: { body: UpdateTenantSchema },
  }, async (req) => updateTenant(fastify.db, req.tenantId, req.body as never))
}
