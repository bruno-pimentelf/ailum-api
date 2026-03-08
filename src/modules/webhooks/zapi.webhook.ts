import type { FastifyInstance } from 'fastify'
import { env } from '../../config/env.js'
import { agentQueue } from '../../jobs/queues.js'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'

// ─── Z-API payload types ──────────────────────────────────────────────────────

interface ZapiTextMessage {
  message: string
}

interface ZapiImageMessage {
  caption?: string
  imageUrl?: string
}

interface ZapiAudioMessage {
  audioUrl?: string
}

interface ZapiDocumentMessage {
  fileName?: string
  documentUrl?: string
}

interface ZapiPayload {
  type: string
  instanceId?: string
  zapiConversationId?: string
  messageId?: string
  phone?: string
  participantPhone?: string
  momment?: number
  status?: string
  chatName?: string
  senderName?: string
  text?: ZapiTextMessage
  image?: ZapiImageMessage
  audio?: ZapiAudioMessage
  document?: ZapiDocumentMessage
  sticker?: unknown
  fromMe?: boolean
}

// ─── Content extractor ────────────────────────────────────────────────────────

function extractContent(payload: ZapiPayload): {
  content: string
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT'
} {
  if (payload.text?.message) {
    return { content: payload.text.message, type: 'TEXT' }
  }
  if (payload.image) {
    return { content: payload.image.caption ?? '[Imagem]', type: 'IMAGE' }
  }
  if (payload.audio) {
    return { content: '[Áudio]', type: 'AUDIO' }
  }
  if (payload.document) {
    return {
      content: `[Arquivo: ${payload.document.fileName ?? 'documento'}]`,
      type: 'DOCUMENT',
    }
  }
  if (payload.sticker) {
    return { content: '[Figurinha]', type: 'TEXT' }
  }
  return { content: '[Mensagem]', type: 'TEXT' }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function zapiWebhookRoutes(fastify: FastifyInstance) {
  fastify.post('/zapi', async (request, reply) => {
    // Always respond 200 so Z-API does not retry
    reply.status(200).send({ ok: true })

    const token = request.headers['client-token'] as string | undefined
    if (token !== env.ZAPI_WEBHOOK_TOKEN) {
      fastify.log.warn({ ip: request.ip }, 'zapi:webhook:invalid_token')
      return
    }

    const payload = request.body as ZapiPayload
    fastify.log.debug({ type: payload.type, phone: payload.phone }, 'zapi:webhook:received')

    // Only process incoming messages
    if (payload.type !== 'ReceivedCallback') return
    // Ignore messages sent by the bot itself
    if (payload.fromMe) return

    const zapiMessageId = payload.messageId
    const phone = payload.phone ?? payload.participantPhone

    if (!phone || !zapiMessageId) {
      fastify.log.warn({ payload }, 'zapi:webhook:missing_phone_or_messageId')
      return
    }

    const instanceId = payload.instanceId

    // Find tenant by Z-API instance ID
    if (!instanceId) {
      fastify.log.warn('zapi:webhook:missing_instanceId')
      return
    }

    const integration = await fastify.db.tenantIntegration.findFirst({
      where: { instanceId, provider: 'zapi', isActive: true },
      select: { tenantId: true },
    })

    if (!integration) {
      fastify.log.warn({ instanceId }, 'zapi:webhook:tenant_not_found')
      return
    }

    const { tenantId } = integration

    // Idempotency check — skip if we already processed this messageId
    const existing = await fastify.db.message.findFirst({
      where: { zapiMessageId, tenantId },
      select: { id: true },
    })
    if (existing) {
      fastify.log.debug({ zapiMessageId }, 'zapi:webhook:duplicate_skipped')
      return
    }

    // Upsert contact
    const contactName = payload.senderName ?? payload.chatName ?? null
    const contact = await fastify.db.contact.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      update: {
        ...(contactName && { name: contactName }),
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        tenantId,
        phone,
        name: contactName,
        status: 'NEW_LEAD',
        lastMessageAt: new Date(),
      },
    })

    // Extract message content
    const { content, type } = extractContent(payload)

    fastify.log.info(
      { contactId: contact.id, tenantId, type, zapiMessageId },
      'zapi:webhook:processing',
    )

    // Save message to Postgres (audit log)
    const savedMessage = await fastify.db.message.create({
      data: {
        tenantId,
        contactId: contact.id,
        role: 'CONTACT',
        type,
        content,
        zapiMessageId,
        sessionId: payload.zapiConversationId,
      },
    })

    // Batch write to Firestore
    const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
    await sync.syncConversationMessage(
      tenantId,
      contact.id,
      {
        id: savedMessage.id,
        role: 'CONTACT',
        type,
        content,
        createdAt: savedMessage.createdAt,
      },
      {
        name: contact.name,
        phone: contact.phone,
        status: contact.status,
      },
    )

    // Enqueue for agent processing
    const job = await agentQueue.add(
      'process-message',
      {
        tenantId,
        contactId: contact.id,
        messageContent: content,
        messageType: type,
        zapiMessageId,
        sessionId: payload.zapiConversationId,
      },
      { jobId: `agent:${contact.id}:${zapiMessageId}` },
    )

    fastify.log.info(
      { jobId: job.id, contactId: contact.id },
      'zapi:webhook:job_enqueued',
    )
  })
}
