import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyBaseLogger } from 'fastify'
import { encrypt, decrypt } from '../../config/encryption.js'
import { env } from '../../config/env.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrationView {
  provider: string
  instanceId: string | null
  webhookToken: string | null
  isActive: boolean
  // apiKey nunca é retornada — só indicamos se está configurada
  hasApiKey: boolean
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listIntegrations(
  db: PrismaClient,
  tenantId: string,
): Promise<IntegrationView[]> {
  const rows = await db.tenantIntegration.findMany({
    where: { tenantId },
    select: {
      provider: true,
      instanceId: true,
      webhookToken: true,
      apiKeyEncrypted: true,
      isActive: true,
    },
    orderBy: { provider: 'asc' },
  })

  return rows.map((r) => ({
    provider: r.provider,
    instanceId: r.instanceId,
    webhookToken: r.webhookToken,
    isActive: r.isActive,
    hasApiKey: !!r.apiKeyEncrypted,
  }))
}

// ─── Z-API ────────────────────────────────────────────────────────────────────

export async function upsertZapiIntegration(
  db: PrismaClient,
  tenantId: string,
  data: { instanceId: string; clientToken: string; webhookToken?: string },
): Promise<IntegrationView> {
  const apiKeyEncrypted = encrypt(data.clientToken)

  const row = await db.tenantIntegration.upsert({
    where: { tenantId_provider: { tenantId, provider: 'zapi' } },
    update: {
      instanceId: data.instanceId,
      apiKeyEncrypted,
      ...(data.webhookToken !== undefined && { webhookToken: data.webhookToken }),
      isActive: true,
    },
    create: {
      tenantId,
      provider: 'zapi',
      instanceId: data.instanceId,
      apiKeyEncrypted,
      webhookToken: data.webhookToken ?? null,
      isActive: true,
    },
    select: {
      provider: true,
      instanceId: true,
      webhookToken: true,
      apiKeyEncrypted: true,
      isActive: true,
    },
  })

  return {
    provider: row.provider,
    instanceId: row.instanceId,
    webhookToken: row.webhookToken,
    isActive: row.isActive,
    hasApiKey: !!row.apiKeyEncrypted,
  }
}

// ─── Asaas ────────────────────────────────────────────────────────────────────

export async function upsertAsaasIntegration(
  db: PrismaClient,
  tenantId: string,
  data: { apiKey: string },
): Promise<IntegrationView> {
  const apiKeyEncrypted = encrypt(data.apiKey)

  const row = await db.tenantIntegration.upsert({
    where: { tenantId_provider: { tenantId, provider: 'asaas' } },
    update: { apiKeyEncrypted, isActive: true },
    create: {
      tenantId,
      provider: 'asaas',
      apiKeyEncrypted,
      isActive: true,
    },
    select: {
      provider: true,
      instanceId: true,
      webhookToken: true,
      apiKeyEncrypted: true,
      isActive: true,
    },
  })

  return {
    provider: row.provider,
    instanceId: row.instanceId,
    webhookToken: row.webhookToken,
    isActive: row.isActive,
    hasApiKey: !!row.apiKeyEncrypted,
  }
}

// ─── Desativar ────────────────────────────────────────────────────────────────

export async function deactivateIntegration(
  db: PrismaClient,
  tenantId: string,
  provider: string,
): Promise<void> {
  await db.tenantIntegration.updateMany({
    where: { tenantId, provider },
    data: { isActive: false },
  })
}

// ─── Z-API HTTP helpers ───────────────────────────────────────────────────────

const ZAPI_BASE = 'https://api.z-api.io'

async function zapiPut(
  instanceId: string,
  clientToken: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${ZAPI_BASE}/instances/${instanceId}/token/${clientToken}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'client-token': clientToken },
    body: JSON.stringify(body),
  })
}

async function zapiGet(
  instanceId: string,
  clientToken: string,
  path: string,
): Promise<Response> {
  return fetch(`${ZAPI_BASE}/instances/${instanceId}/token/${clientToken}${path}`, {
    headers: { 'client-token': clientToken },
  })
}

// ─── Registrar webhooks na Z-API automaticamente ──────────────────────────────
// Configura todos os webhooks apontando para nosso endpoint único.

export async function registerZapiWebhooks(
  instanceId: string,
  clientToken: string,
  logger?: FastifyBaseLogger,
): Promise<{ success: boolean; error?: string }> {
  const baseUrl = env.BETTER_AUTH_URL // URL pública do backend
  const webhookUrl = `${baseUrl}/webhooks/zapi`

  try {
    const res = await zapiPut(instanceId, clientToken, '/update-every-webhooks', {
      value: webhookUrl,
      notifySentByMe: true,
    })

    if (!res.ok) {
      const text = await res.text()
      logger?.warn({ status: res.status, body: text }, 'zapi:register_webhooks:failed')
      return { success: false, error: `Z-API retornou ${res.status}: ${text}` }
    }

    logger?.info({ instanceId, webhookUrl }, 'zapi:register_webhooks:configured')
    return { success: true }
  } catch (err) {
    logger?.error({ err }, 'zapi:register_webhooks:error')
    return { success: false, error: 'Falha de conexão com a Z-API' }
  }
}

// ─── Testar conexão Z-API ─────────────────────────────────────────────────────

export async function testZapiConnection(
  db: PrismaClient,
  tenantId: string,
): Promise<{ connected: boolean; phone: string | null }> {
  const integration = await db.tenantIntegration.findFirst({
    where: { tenantId, provider: 'zapi', isActive: true },
    select: { instanceId: true, apiKeyEncrypted: true },
  })

  if (!integration?.instanceId || !integration.apiKeyEncrypted) {
    return { connected: false, phone: null }
  }

  const clientToken = decrypt(integration.apiKeyEncrypted)

  try {
    const res = await zapiGet(integration.instanceId, clientToken, '/status')
    if (!res.ok) return { connected: false, phone: null }

    const body = (await res.json()) as { connected?: boolean; smartphoneConnected?: boolean; session?: string }
    return {
      connected: body.connected === true || body.smartphoneConnected === true,
      phone: body.session ?? null,
    }
  } catch {
    return { connected: false, phone: null }
  }
}
