import type { FastifyInstance } from 'fastify'
import {
  TemplateParamsSchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
} from './templates.schema.js'
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from './templates.service.js'
import { PERMISSIONS } from '../../constants/permissions.js'

export async function templatesRoutes(fastify: FastifyInstance) {
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TEMPLATES_READ)],
  }, async (req) => listTemplates(fastify.db, req.tenantId))

  fastify.get('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TEMPLATES_READ)],
    schema: { params: TemplateParamsSchema },
  }, async (req, reply) => {
    const template = await getTemplateById(
      fastify.db,
      req.tenantId,
      (req.params as { id: string }).id,
    )
    if (!template) return reply.notFound('Template not found')
    return template
  })

  fastify.post('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TEMPLATES_WRITE)],
    schema: { body: CreateTemplateSchema },
  }, async (req, reply) =>
    reply.status(201).send(await createTemplate(fastify.db, req.tenantId, req.body as never)))

  fastify.patch('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TEMPLATES_WRITE)],
    schema: { params: TemplateParamsSchema, body: UpdateTemplateSchema },
  }, async (req) =>
    updateTemplate(
      fastify.db,
      req.tenantId,
      (req.params as { id: string }).id,
      req.body as never,
    ))

  fastify.delete('/:id', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TEMPLATES_WRITE)],
    schema: { params: TemplateParamsSchema },
  }, async (req) => deleteTemplate(fastify.db, req.tenantId, (req.params as { id: string }).id))
}
