import type { PrismaClient } from '../generated/prisma/client.js'
import { decrypt } from '../config/encryption.js'
import { env } from '../config/env.js'

const BASE_URL = 'https://api.z-api.io'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZapiConfig {
  instanceId: string
  clientToken: string
}

export interface ZapiSendResult {
  zapiId: string
}

export class ZapiApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ZapiApiError'
  }
}

// ─── Config loader ────────────────────────────────────────────────────────────

export async function getZapiConfig(
  tenantId: string,
  db: PrismaClient,
): Promise<ZapiConfig | null> {
  const integration = await db.tenantIntegration.findFirst({
    where: { tenantId, provider: 'zapi', isActive: true },
    select: { instanceId: true, apiKeyEncrypted: true },
  })

  if (!integration?.instanceId || !integration.apiKeyEncrypted) return null

  return {
    instanceId: integration.instanceId,
    clientToken: decrypt(integration.apiKeyEncrypted),
  }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function zapiFetch<T>(
  instanceId: string,
  instanceToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await globalThis.fetch(
    `${BASE_URL}/instances/${instanceId}/token/${instanceToken}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-token': env.ZAPI_WEBHOOK_TOKEN,
      },
      body: JSON.stringify(body),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new ZapiApiError(response.status, `Z-API ${response.status} on ${path}: ${text}`)
  }

  return response.json() as Promise<T>
}

// ─── Send functions ───────────────────────────────────────────────────────────

export async function sendText(
  instanceId: string,
  clientToken: string,
  phone: string,
  message: string,
): Promise<ZapiSendResult> {
  return zapiFetch<ZapiSendResult>(instanceId, clientToken, '/send-text', {
    phone,
    message,
  })
}

export async function sendImage(
  instanceId: string,
  clientToken: string,
  phone: string,
  imageUrl: string,
  caption?: string,
): Promise<ZapiSendResult> {
  return zapiFetch<ZapiSendResult>(instanceId, clientToken, '/send-image', {
    phone,
    image: imageUrl,
    caption,
  })
}

export async function sendAudio(
  instanceId: string,
  clientToken: string,
  phone: string,
  audioUrl: string,
): Promise<ZapiSendResult> {
  return zapiFetch<ZapiSendResult>(instanceId, clientToken, '/send-audio', {
    phone,
    audio: audioUrl,
  })
}

export async function sendDocument(
  instanceId: string,
  clientToken: string,
  phone: string,
  docUrl: string,
  filename: string,
): Promise<ZapiSendResult> {
  return zapiFetch<ZapiSendResult>(instanceId, clientToken, '/send-document', {
    phone,
    document: docUrl,
    fileName: filename,
  })
}

// ─── Convenience class (backwards-compat with existing callers) ───────────────

export class ZapiService {
  async sendText(params: {
    instanceId: string
    apiKey: string
    phone: string
    message: string
  }): Promise<ZapiSendResult> {
    return sendText(params.instanceId, params.apiKey, params.phone, params.message)
  }

  async sendMedia(params: {
    instanceId: string
    apiKey: string
    phone: string
    message: string
    mediaUrl: string
    caption?: string
    type: 'image' | 'audio' | 'document'
  }): Promise<ZapiSendResult> {
    switch (params.type) {
      case 'image':
        return sendImage(params.instanceId, params.apiKey, params.phone, params.mediaUrl, params.caption)
      case 'audio':
        return sendAudio(params.instanceId, params.apiKey, params.phone, params.mediaUrl)
      case 'document':
        return sendDocument(params.instanceId, params.apiKey, params.phone, params.mediaUrl, params.caption ?? 'document')
    }
  }
}
