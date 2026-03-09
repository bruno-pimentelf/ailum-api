import type { FastifyInstance } from 'fastify'
import { PERMISSIONS } from '../../constants/permissions.js'
import {
  ProviderParamsSchema,
  UpsertZapiSchema,
  UpsertAsaasSchema,
} from './integrations.schema.js'
import {
  listIntegrations,
  upsertZapiIntegration,
  upsertAsaasIntegration,
  deactivateIntegration,
  testZapiConnection,
  registerZapiWebhooks,
} from './integrations.service.js'

export async function integrationsRoutes(fastify: FastifyInstance) {
  // GET /v1/integrations — lista todas as integrações do tenant (sem expor API keys)
  fastify.get('/', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_SETTINGS_READ)],
  }, async (req) => listIntegrations(fastify.db, req.tenantId))

  // PUT /v1/integrations/zapi — cadastra ou atualiza credenciais Z-API
  // Auto-configura todos os webhooks na Z-API apontando para nosso endpoint
  fastify.put('/zapi', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_INTEGRATIONS_WRITE)],
    schema: { body: UpsertZapiSchema },
  }, async (req, reply) => {
    const body = req.body as { instanceId: string; instanceToken: string }
    const result = await upsertZapiIntegration(fastify.db, req.tenantId, body)

    const webhookResult = await registerZapiWebhooks(
      body.instanceId,
      body.instanceToken,
      fastify.log,
    )

    return reply.status(200).send({
      ...result,
      webhooksConfigured: webhookResult.success,
      webhooksError: webhookResult.error,
    })
  })

  // GET /v1/integrations/zapi/test — testa a conexão Z-API (instância conectada ao WA?)
  fastify.get('/zapi/test', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_SETTINGS_READ)],
  }, async (req) => testZapiConnection(fastify.db, req.tenantId))

  // PUT /v1/integrations/asaas — cadastra ou atualiza chave Asaas
  fastify.put('/asaas', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_INTEGRATIONS_WRITE)],
    schema: { body: UpsertAsaasSchema },
  }, async (req, reply) => {
    const body = req.body as { apiKey: string }
    const result = await upsertAsaasIntegration(fastify.db, req.tenantId, body)
    return reply.status(200).send(result)
  })

  // DELETE /v1/integrations/:provider — desativa uma integração
  fastify.delete('/:provider', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_INTEGRATIONS_WRITE)],
    schema: { params: ProviderParamsSchema },
  }, async (req, reply) => {
    const { provider } = req.params as { provider: string }
    await deactivateIntegration(fastify.db, req.tenantId, provider)
    return reply.status(204).send()
  })
}
