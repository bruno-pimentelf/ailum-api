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
  getAsaasApiKey,
  deactivateIntegration,
  testZapiConnection,
  registerZapiWebhooks,
  getZapiQrCode,
  disconnectZapiInstance,
  restartZapiInstance,
} from './integrations.service.js'
import {
  listCustomers,
  listPayments,
  getFinanceBalance,
  listMunicipalOptions,
  scheduleInvoice,
  createPaymentLink,
  listPaymentLinks,
  getPaymentLink,
  createSubscription,
  listSubscriptions,
} from '../../services/asaas.service.js'
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

  // ── Asaas Finance (módulo financeiro) ────────────────────────────────────────
  const asaasAuth = [fastify.authenticate, fastify.authorize(PERMISSIONS.BILLING_READ)]

  // GET /v1/integrations/asaas/customers — lista clientes do Asaas
  fastify.get('/asaas/customers', { onRequest: asaasAuth }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const q = req.query as { offset?: string; limit?: string; name?: string; cpfCnpj?: string; externalReference?: string }
    const data = await listCustomers(apiKey, {
      offset: q.offset != null ? Number(q.offset) : undefined,
      limit: q.limit != null ? Number(q.limit) : undefined,
      name: q.name,
      cpfCnpj: q.cpfCnpj,
      externalReference: q.externalReference,
    })
    return data
  })

  // GET /v1/integrations/asaas/payments — lista cobranças do Asaas
  fastify.get('/asaas/payments', { onRequest: asaasAuth }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const q = req.query as {
      offset?: string; limit?: string; customer?: string; billingType?: string;
      status?: string; externalReference?: string;
      dateCreatedGe?: string; dateCreatedLe?: string;
      dueDateGe?: string; dueDateLe?: string;
      paymentDateGe?: string; paymentDateLe?: string;
    }
    const data = await listPayments(apiKey, {
      offset: q.offset != null ? Number(q.offset) : undefined,
      limit: q.limit != null ? Number(q.limit) : undefined,
      customer: q.customer,
      billingType: q.billingType,
      status: q.status,
      externalReference: q.externalReference,
      dateCreated: (q.dateCreatedGe || q.dateCreatedLe) ? { ge: q.dateCreatedGe, le: q.dateCreatedLe } : undefined,
      dueDate: (q.dueDateGe || q.dueDateLe) ? { ge: q.dueDateGe, le: q.dueDateLe } : undefined,
      paymentDate: (q.paymentDateGe || q.paymentDateLe) ? { ge: q.paymentDateGe, le: q.paymentDateLe } : undefined,
    })
    return data
  })

  // GET /v1/integrations/asaas/finance/balance — saldo da conta Asaas
  fastify.get('/asaas/finance/balance', { onRequest: asaasAuth }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const data = await getFinanceBalance(apiKey)
    return data
  })

  // GET /v1/integrations/asaas/municipal-options — serviços municipais para NF
  fastify.get('/asaas/municipal-options', { onRequest: asaasAuth }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const data = await listMunicipalOptions(apiKey)
    return data
  })

  // POST /v1/integrations/asaas/invoices — agenda nota fiscal para uma cobrança
  fastify.post('/asaas/invoices', {
    onRequest: [fastify.authenticate, fastify.authorize(PERMISSIONS.BILLING_WRITE)],
    schema: {
      body: {
        type: 'object',
        required: ['payment', 'serviceDescription', 'observations', 'value', 'effectiveDate', 'municipalServiceName', 'taxes'],
        properties: {
          payment: { type: 'string' },
          serviceDescription: { type: 'string' },
          observations: { type: 'string' },
          value: { type: 'number' },
          deductions: { type: 'number' },
          effectiveDate: { type: 'string', format: 'date' },
          municipalServiceId: { type: 'string' },
          municipalServiceCode: { type: 'string' },
          municipalServiceName: { type: 'string' },
          externalReference: { type: 'string' },
          updatePayment: { type: 'boolean' },
          taxes: {
            type: 'object',
            required: ['retainIss', 'iss', 'pis', 'cofins', 'csll', 'inss', 'ir'],
            properties: {
              retainIss: { type: 'boolean' },
              iss: { type: 'number' },
              pis: { type: 'number' },
              cofins: { type: 'number' },
              csll: { type: 'number' },
              inss: { type: 'number' },
              ir: { type: 'number' },
              pisCofinsRetentionType: { type: 'string' },
              pisCofinsTaxStatus: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const body = req.body as Parameters<typeof scheduleInvoice>[1]
    const invoice = await scheduleInvoice(apiKey, body)
    return reply.status(201).send(invoice)
  })

  // ── Payment Links ───────────────────────────────────────────────────────────
  const asaasBillingWrite = [fastify.authenticate, fastify.authorize(PERMISSIONS.BILLING_WRITE)]

  // GET /v1/integrations/asaas/payment-links — lista links de pagamento
  fastify.get('/asaas/payment-links', { onRequest: asaasAuth }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const q = req.query as { offset?: string; limit?: string; active?: string; name?: string; externalReference?: string }
    const data = await listPaymentLinks(apiKey, {
      offset: q.offset != null ? Number(q.offset) : undefined,
      limit: q.limit != null ? Number(q.limit) : undefined,
      active: q.active === 'true' ? true : q.active === 'false' ? false : undefined,
      name: q.name,
      externalReference: q.externalReference,
    })
    return data
  })

  // POST /v1/integrations/asaas/payment-links — cria link de pagamento
  fastify.post('/asaas/payment-links', {
    onRequest: asaasBillingWrite,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'billingType', 'chargeType'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          value: { type: 'number' },
          billingType: { type: 'string', enum: ['UNDEFINED', 'BOLETO', 'CREDIT_CARD', 'PIX'] },
          chargeType: { type: 'string', enum: ['DETACHED', 'RECURRENT', 'INSTALLMENT'] },
          subscriptionCycle: { type: 'string', enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'] },
          maxInstallmentCount: { type: 'number' },
          dueDateLimitDays: { type: 'number' },
          endDate: { type: 'string', format: 'date' },
          externalReference: { type: 'string' },
          notificationEnabled: { type: 'boolean' },
          isAddressRequired: { type: 'boolean' },
          callback: { type: 'object', properties: { successUrl: { type: 'string' }, autoRedirect: { type: 'boolean' } } },
        },
      },
    },
  }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const body = req.body as Parameters<typeof createPaymentLink>[1]
    const link = await createPaymentLink(apiKey, body)
    return reply.status(201).send(link)
  })

  // GET /v1/integrations/asaas/payment-links/:id — detalhe de um link (inclui viewCount)
  fastify.get('/asaas/payment-links/:id', { onRequest: asaasAuth }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const { id } = req.params as { id: string }
    const link = await getPaymentLink(apiKey, id)
    return link
  })

  // ── Subscriptions ───────────────────────────────────────────────────────────

  // GET /v1/integrations/asaas/subscriptions — lista assinaturas
  fastify.get('/asaas/subscriptions', { onRequest: asaasAuth }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const q = req.query as { offset?: string; limit?: string; customer?: string; billingType?: string; status?: string; externalReference?: string }
    const data = await listSubscriptions(apiKey, {
      offset: q.offset != null ? Number(q.offset) : undefined,
      limit: q.limit != null ? Number(q.limit) : undefined,
      customer: q.customer,
      billingType: q.billingType as 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX' | undefined,
      status: q.status as 'ACTIVE' | 'EXPIRED' | 'INACTIVE' | undefined,
      externalReference: q.externalReference,
    })
    return data
  })

  // POST /v1/integrations/asaas/subscriptions — cria assinatura (por cliente)
  fastify.post('/asaas/subscriptions', {
    onRequest: asaasBillingWrite,
    schema: {
      body: {
        type: 'object',
        required: ['customer', 'billingType', 'value', 'nextDueDate', 'cycle'],
        properties: {
          customer: { type: 'string' },
          billingType: { type: 'string', enum: ['UNDEFINED', 'BOLETO', 'CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'DEPOSIT', 'PIX'] },
          value: { type: 'number' },
          nextDueDate: { type: 'string', format: 'date' },
          cycle: { type: 'string', enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'] },
          description: { type: 'string' },
          endDate: { type: 'string', format: 'date' },
          maxPayments: { type: 'number' },
          externalReference: { type: 'string' },
          discount: { type: 'object', properties: { value: { type: 'number' }, dueDateLimitDays: { type: 'number' }, type: { type: 'string', enum: ['FIXED', 'PERCENTAGE'] } } },
          fine: { type: 'object', properties: { value: { type: 'number' }, type: { type: 'string', enum: ['FIXED', 'PERCENTAGE'] } } },
          interest: { type: 'object', properties: { value: { type: 'number' } } },
        },
      },
    },
  }, async (req, reply) => {
    const apiKey = await getAsaasApiKey(fastify.db, req.tenantId)
    if (!apiKey) return reply.code(404).send({ error: 'Integração Asaas não configurada' })
    const body = req.body as Parameters<typeof createSubscription>[1]
    const sub = await createSubscription(apiKey, body)
    return reply.status(201).send(sub)
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
