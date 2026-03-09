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
  getZapiQrCode,
  disconnectZapiInstance,
  restartZapiInstance,
} from './integrations.service.js'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'

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

    // Consulta o status real da instância na Z-API e já inicializa o doc
    // do tenant no Firestore com o valor correto (connected ou não),
    // sem depender do primeiro webhook para criar o documento.
    const status = await testZapiConnection(fastify.db, req.tenantId)
    const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
    await sync.syncInstanceStatus(req.tenantId, status.connected, status.error ?? undefined)

    return reply.status(200).send({
      ...result,
      webhooksConfigured: webhookResult.success,
      webhooksError: webhookResult.error,
    })
  })

  // GET /v1/integrations/zapi/status — status da conexão da instância
  fastify.get('/zapi/status', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_SETTINGS_READ)],
  }, async (req) => testZapiConnection(fastify.db, req.tenantId))

  // GET /v1/integrations/zapi/qrcode — QR code base64 para escanear com o WhatsApp
  // O QR code expira a cada 20s — o front deve fazer polling a cada 10-15s
  fastify.get('/zapi/qrcode', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_SETTINGS_READ)],
  }, async (req, reply) => {
    const result = await getZapiQrCode(fastify.db, req.tenantId)
    if (!result) return reply.notFound('QR code indisponível — instância não configurada ou já conectada')
    return result
  })

  // POST /v1/integrations/zapi/disconnect — desconecta o WhatsApp da instância
  fastify.post('/zapi/disconnect', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_INTEGRATIONS_WRITE)],
  }, async (req, reply) => {
    const ok = await disconnectZapiInstance(fastify.db, req.tenantId)
    if (!ok) return reply.internalServerError('Falha ao desconectar instância')
    return { disconnected: true }
  })

  // POST /v1/integrations/zapi/restart — reinicia a instância Z-API
  fastify.post('/zapi/restart', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.TENANT_INTEGRATIONS_WRITE)],
  }, async (req, reply) => {
    const ok = await restartZapiInstance(fastify.db, req.tenantId)
    if (!ok) return reply.internalServerError('Falha ao reiniciar instância')
    return { restarted: true }
  })

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
