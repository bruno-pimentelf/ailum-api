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
  data: { instanceId: string; instanceToken: string },
): Promise<IntegrationView> {
  // Garante que a instanceId não está em uso por outro tenant ativo.
  // Uma instância Z-API = um número WhatsApp = um único tenant.
  const conflict = await db.tenantIntegration.findFirst({
    where: {
      instanceId: data.instanceId,
      provider: 'zapi',
      isActive: true,
      NOT: { tenantId },   // ignora o próprio tenant (re-cadastro da mesma instância)
    },
    select: { tenantId: true },
  })

  if (conflict) {
    throw Object.assign(
      new Error('Esta instância Z-API já está cadastrada em outra clínica'),
      { statusCode: 409 },
    )
  }

  const apiKeyEncrypted = encrypt(data.instanceToken)

  const row = await db.tenantIntegration.upsert({
    where: { tenantId_provider: { tenantId, provider: 'zapi' } },
    update: {
      instanceId: data.instanceId,
      apiKeyEncrypted,
      isActive: true,
    },
    create: {
      tenantId,
      provider: 'zapi',
      instanceId: data.instanceId,
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

// Na Z-API, a URL usa o instanceToken para identificar a instância,
// mas o header client-token deve ser o Client-Token da conta (env.ZAPI_WEBHOOK_TOKEN).
async function zapiPut(
  instanceId: string,
  instanceToken: string,
  path: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${ZAPI_BASE}/instances/${instanceId}/token/${instanceToken}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'client-token': env.ZAPI_WEBHOOK_TOKEN },
    body: JSON.stringify(body),
  })
}

async function zapiGet(
  instanceId: string,
  instanceToken: string,
  path: string,
): Promise<Response> {
  return fetch(`${ZAPI_BASE}/instances/${instanceId}/token/${instanceToken}${path}`, {
    headers: { 'client-token': env.ZAPI_WEBHOOK_TOKEN },
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

// ─── Helper: busca credenciais Z-API do tenant ────────────────────────────────

async function getZapiCredentials(
  db: PrismaClient,
  tenantId: string,
): Promise<{ instanceId: string; instanceToken: string } | null> {
  const integration = await db.tenantIntegration.findFirst({
    where: { tenantId, provider: 'zapi', isActive: true },
    select: { instanceId: true, apiKeyEncrypted: true },
  })
  if (!integration?.instanceId || !integration.apiKeyEncrypted) return null
  return {
    instanceId: integration.instanceId,
    instanceToken: decrypt(integration.apiKeyEncrypted),
  }
}

// ─── Status da conexão ────────────────────────────────────────────────────────

export async function testZapiConnection(
  db: PrismaClient,
  tenantId: string,
): Promise<{ connected: boolean; smartphoneConnected: boolean; error: string | null }> {
  const creds = await getZapiCredentials(db, tenantId)
  if (!creds) return { connected: false, smartphoneConnected: false, error: 'Integração não configurada' }

  try {
    const res = await zapiGet(creds.instanceId, creds.instanceToken, '/status')
    if (!res.ok) return { connected: false, smartphoneConnected: false, error: `Z-API ${res.status}` }

    const body = (await res.json()) as { connected?: boolean; smartphoneConnected?: boolean; error?: string }
    return {
      connected: body.connected === true,
      smartphoneConnected: body.smartphoneConnected === true,
      error: body.error ?? null,
    }
  } catch {
    return { connected: false, smartphoneConnected: false, error: 'Falha de conexão' }
  }
}

// ─── QR Code ──────────────────────────────────────────────────────────────────

export async function getZapiQrCode(
  db: PrismaClient,
  tenantId: string,
): Promise<{ value: string } | null> {
  const creds = await getZapiCredentials(db, tenantId)
  if (!creds) return null

  const res = await zapiGet(creds.instanceId, creds.instanceToken, '/qr-code/image')
  if (!res.ok) return null

  const body = (await res.json()) as { value?: string }
  return body.value ? { value: body.value } : null
}

// ─── Desconectar instância ────────────────────────────────────────────────────

export async function disconnectZapiInstance(
  db: PrismaClient,
  tenantId: string,
): Promise<boolean> {
  const creds = await getZapiCredentials(db, tenantId)
  if (!creds) return false

  const res = await zapiGet(creds.instanceId, creds.instanceToken, '/disconnect')
  return res.ok
}

// ─── Reiniciar instância ──────────────────────────────────────────────────────

export async function restartZapiInstance(
  db: PrismaClient,
  tenantId: string,
): Promise<boolean> {
  const creds = await getZapiCredentials(db, tenantId)
  if (!creds) return false

  const res = await zapiGet(creds.instanceId, creds.instanceToken, '/restart')
  return res.ok
}
