import type { FastifyInstance } from 'fastify'
import { agentQueue, photoSyncQueue } from '../../jobs/queues.js'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'

// ═══════════════════════════════════════════════════════════════════════════════
// Z-API Payload Types — one per webhook callback type
// ═══════════════════════════════════════════════════════════════════════════════

// ── Conteúdos de mensagem recebida ──────────────────────────────────────────

interface ZapiTextContent {
  message: string
  description?: string
  title?: string
  url?: string
  thumbnailUrl?: string
}

interface ZapiImageContent {
  imageUrl: string
  thumbnailUrl?: string
  caption?: string
  mimeType?: string
  width?: number
  height?: number
  viewOnce?: boolean
}

interface ZapiAudioContent {
  audioUrl: string
  mimeType?: string
  ptt?: boolean
  seconds?: number
  viewOnce?: boolean
}

interface ZapiVideoContent {
  videoUrl: string
  caption?: string
  mimeType?: string
  seconds?: number
  viewOnce?: boolean
}

interface ZapiDocumentContent {
  documentUrl: string
  fileName?: string
  title?: string
  mimeType?: string
  pageCount?: number
  thumbnailUrl?: string
}

interface ZapiStickerContent {
  stickerUrl: string
  mimeType?: string
  isAnimated?: boolean
}

interface ZapiLocationContent {
  latitude: number
  longitude: number
  name?: string
  address?: string
  url?: string
  thumbnailUrl?: string
}

interface ZapiContactContent {
  displayName: string
  vCard: string
  phones?: string[]
}

interface ZapiReactionContent {
  value: string
  time: number
  reactionBy: string
  referencedMessage?: {
    messageId: string
    fromMe: boolean
    phone: string
    participant: string | null
  }
}

interface ZapiButtonsResponseContent {
  buttonId: string
  message: string
}

interface ZapiListResponseContent {
  message: string
  title?: string
  selectedRowId?: string
}

interface ZapiHydratedTemplate {
  header?: {
    image?: ZapiImageContent
    video?: ZapiVideoContent
    document?: ZapiDocumentContent
  }
  message?: string
  footer?: string
  title?: string
  templateId?: string
  hydratedButtons?: unknown[]
}

// ── ReceivedCallback ────────────────────────────────────────────────────────

interface ZapiReceivedPayload {
  type: 'ReceivedCallback'
  instanceId?: string
  messageId?: string
  zapiConversationId?: string
  phone?: string
  participantPhone?: string
  senderName?: string
  chatName?: string
  senderPhoto?: string
  photo?: string
  fromMe?: boolean
  isGroup?: boolean
  isNewsletter?: boolean
  waitingMessage?: boolean
  isEdit?: boolean
  isStatusReply?: boolean
  broadcast?: boolean
  forwarded?: boolean
  fromApi?: boolean
  status?: string
  momment?: number
  referenceMessageId?: string
  messageExpirationSeconds?: number
  connectedPhone?: string
  chatLid?: string | null
  senderLid?: string | null

  text?: ZapiTextContent
  image?: ZapiImageContent
  audio?: ZapiAudioContent
  video?: ZapiVideoContent
  document?: ZapiDocumentContent
  sticker?: ZapiStickerContent
  location?: ZapiLocationContent
  contact?: ZapiContactContent
  reaction?: ZapiReactionContent
  buttonsResponseMessage?: ZapiButtonsResponseContent
  listResponseMessage?: ZapiListResponseContent
  hydratedTemplate?: ZapiHydratedTemplate

  notification?: string
  notificationParameters?: string[]
}

// ── DeliveryCallback (mensagem enviada com sucesso) ─────────────────────────

interface ZapiDeliveryPayload {
  type: 'DeliveryCallback'
  instanceId?: string
  phone?: string
  zaapId?: string
  messageId?: string
}

// ── MessageStatusCallback (SENT, RECEIVED, READ, PLAYED) ────────────────────

interface ZapiMessageStatusPayload {
  type: 'MessageStatusCallback'
  instanceId?: string
  phone?: string
  status: 'SENT' | 'RECEIVED' | 'READ' | 'READ_BY_ME' | 'PLAYED'
  ids?: string[]
  momment?: number
  isGroup?: boolean
}

// ── DisconnectedCallback ────────────────────────────────────────────────────

interface ZapiDisconnectedPayload {
  type: 'DisconnectedCallback'
  instanceId?: string
  momment?: number
  error?: string
  disconnected?: boolean
}

// ── ConnectedCallback ───────────────────────────────────────────────────────

interface ZapiConnectedPayload {
  type: 'ConnectedCallback'
  instanceId?: string
  connected?: boolean
  phone?: string
  momment?: number
}

// ── PresenceChatCallback ────────────────────────────────────────────────────

interface ZapiPresencePayload {
  type: 'PresenceChatCallback'
  instanceId?: string
  phone?: string
  status: 'UNAVAILABLE' | 'AVAILABLE' | 'COMPOSING' | 'RECORDING' | 'PAUSED'
  lastSeen?: number | null
}

// ── Union ───────────────────────────────────────────────────────────────────

type ZapiPayload =
  | ZapiReceivedPayload
  | ZapiDeliveryPayload
  | ZapiMessageStatusPayload
  | ZapiDisconnectedPayload
  | ZapiConnectedPayload
  | ZapiPresencePayload
  | { type: string; instanceId?: string; [key: string]: unknown }

// ═══════════════════════════════════════════════════════════════════════════════
// Content extractor (ReceivedCallback only)
// ═══════════════════════════════════════════════════════════════════════════════

type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT'

interface ExtractedMessage {
  content: string
  type: MessageType
  metadata: Record<string, unknown> | null
}

function extractContent(payload: ZapiReceivedPayload): ExtractedMessage | null {
  if (payload.text?.message) {
    return {
      content: payload.text.message,
      type: 'TEXT',
      metadata: payload.text.url ? { url: payload.text.url } : null,
    }
  }

  if (payload.buttonsResponseMessage) {
    return {
      content: payload.buttonsResponseMessage.message,
      type: 'TEXT',
      metadata: { buttonId: payload.buttonsResponseMessage.buttonId },
    }
  }

  if (payload.listResponseMessage) {
    return {
      content: payload.listResponseMessage.message,
      type: 'TEXT',
      metadata: { selectedRowId: payload.listResponseMessage.selectedRowId },
    }
  }

  if (payload.hydratedTemplate?.message && !payload.hydratedTemplate.header) {
    return {
      content: payload.hydratedTemplate.message,
      type: 'TEXT',
      metadata: { templateId: payload.hydratedTemplate.templateId },
    }
  }

  if (payload.image) {
    return {
      content: payload.image.caption || '[Imagem]',
      type: 'IMAGE',
      metadata: {
        imageUrl: payload.image.imageUrl,
        thumbnailUrl: payload.image.thumbnailUrl,
        mimeType: payload.image.mimeType,
        width: payload.image.width,
        height: payload.image.height,
        viewOnce: payload.image.viewOnce,
      },
    }
  }

  if (payload.audio) {
    return {
      content: payload.audio.ptt ? '[Mensagem de voz]' : '[Áudio]',
      type: 'AUDIO',
      metadata: {
        audioUrl: payload.audio.audioUrl,
        mimeType: payload.audio.mimeType,
        ptt: payload.audio.ptt,
        seconds: payload.audio.seconds,
        viewOnce: payload.audio.viewOnce,
      },
    }
  }

  if (payload.video) {
    return {
      content: payload.video.caption || '[Vídeo]',
      type: 'DOCUMENT',
      metadata: {
        videoUrl: payload.video.videoUrl,
        mimeType: payload.video.mimeType,
        seconds: payload.video.seconds,
        viewOnce: payload.video.viewOnce,
        mediaKind: 'video',
      },
    }
  }

  if (payload.document) {
    return {
      content: `[Arquivo: ${payload.document.fileName ?? payload.document.title ?? 'documento'}]`,
      type: 'DOCUMENT',
      metadata: {
        documentUrl: payload.document.documentUrl,
        fileName: payload.document.fileName,
        mimeType: payload.document.mimeType,
        pageCount: payload.document.pageCount,
        thumbnailUrl: payload.document.thumbnailUrl,
      },
    }
  }

  if (payload.location) {
    const label = payload.location.name ?? payload.location.address ?? 'localização'
    return {
      content: `[Localização: ${label}]`,
      type: 'TEXT',
      metadata: {
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
        name: payload.location.name,
        address: payload.location.address,
        url: payload.location.url,
        mediaKind: 'location',
      },
    }
  }

  if (payload.contact) {
    return {
      content: `[Contato compartilhado: ${payload.contact.displayName}]`,
      type: 'TEXT',
      metadata: {
        displayName: payload.contact.displayName,
        vCard: payload.contact.vCard,
        phones: payload.contact.phones,
        mediaKind: 'contact',
      },
    }
  }

  if (payload.sticker) {
    return {
      content: '[Figurinha]',
      type: 'TEXT',
      metadata: {
        stickerUrl: payload.sticker.stickerUrl,
        mimeType: payload.sticker.mimeType,
        isAnimated: payload.sticker.isAnimated,
        mediaKind: 'sticker',
      },
    }
  }

  if (payload.hydratedTemplate) {
    const text = payload.hydratedTemplate.message ?? payload.hydratedTemplate.title
    if (text) {
      return {
        content: text,
        type: 'TEXT',
        metadata: { templateId: payload.hydratedTemplate.templateId, mediaKind: 'template' },
      }
    }
  }

  if (payload.reaction) return null
  if (payload.notification) return null

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function findTenantByInstance(fastify: FastifyInstance, instanceId: string) {
  const integration = await fastify.db.tenantIntegration.findFirst({
    where: { instanceId, provider: 'zapi', isActive: true },
    select: { tenantId: true },
  })

  if (!integration) {
    fastify.log.warn(
      { instanceId },
      'zapi:webhook:tenant_not_found_for_instance',
    )
  }

  return integration
}

// ═══════════════════════════════════════════════════════════════════════════════
// Handlers — um por tipo de callback
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1. ReceivedCallback — mensagem recebida pelo WhatsApp ───────────────────

function isLid(phone: string): boolean {
  return phone.endsWith('@lid')
}

function isRealPhone(phone: string): boolean {
  return /^\d{10,15}$/.test(phone) && !phone.includes('@')
}

async function handleReceived(fastify: FastifyInstance, payload: ZapiReceivedPayload) {
  // Grupos e newsletters nunca são processados
  if (payload.isGroup || payload.isNewsletter) return
  if (payload.waitingMessage) return

  let phone = payload.phone ?? payload.participantPhone
  const zapiMessageId = payload.messageId
  const instanceId = payload.instanceId

  if (!phone || !zapiMessageId || !instanceId) {
    fastify.log.warn({ phone, zapiMessageId, instanceId }, 'zapi:received:missing_fields')
    return
  }

  const SYSTEM_PHONES = ['status@broadcast', 'status@s.whatsapp.net']
  if (SYSTEM_PHONES.includes(phone)) {
    fastify.log.debug({ phone }, 'zapi:received:system_phone_skipped')
    return
  }

  // Quando phone é @lid: preferir contact.phones com número real se disponível (evita criar contato duplicado com LID)
  if (isLid(phone)) {
    const realPhone = payload.contact?.phones?.find((p) => isRealPhone(p))
    if (realPhone) phone = realPhone
  }

  const extracted = extractContent(payload)
  if (!extracted) {
    fastify.log.debug({ zapiMessageId, phone, fromMe: payload.fromMe }, 'zapi:received:skipped_non_actionable')
    return
  }

  const integration = await findTenantByInstance(fastify, instanceId)
  if (!integration) {
    fastify.log.warn({ instanceId }, 'zapi:received:tenant_not_found')
    return
  }

  const { tenantId } = integration

  const existing = await fastify.db.message.findFirst({
    where: { zapiMessageId, tenantId },
    select: { id: true },
  })
  if (existing) {
    fastify.log.debug({ zapiMessageId }, 'zapi:received:duplicate_skipped')
    return
  }

  const contactName =
    payload.senderName && payload.senderName !== phone
      ? payload.senderName
      : (payload.chatName ?? null)

  // senderPhoto vem no payload — URL temporária do WhatsApp (expira em 48h)
  const senderPhoto = !payload.fromMe ? (payload.senderPhoto ?? null) : null

  // Quando fromMe e phone ainda é @lid: não criar novo contato — buscar por zapiChatLid ou última mensagem enviada
  if (payload.fromMe && isLid(phone)) {
    const chatLid = payload.chatLid ?? phone
    const existingByLid = await fastify.db.contact.findFirst({
      where: { tenantId, zapiChatLid: chatLid },
      select: { id: true, phone: true, name: true, status: true, photoUrl: true },
    })
    if (existingByLid) {
      const contact = existingByLid
      const extracted = extractContent(payload)
      if (!extracted) return
      const { content, type, metadata } = extracted
      const role = 'OPERATOR'
      const savedMessage = await fastify.db.message.create({
        data: {
          tenantId,
          contactId: contact.id,
          role,
          type,
          content,
          metadata: metadata ? (metadata as object) : undefined,
          zapiMessageId,
          sessionId: payload.zapiConversationId,
        },
      })
      await fastify.db.contact.update({
        where: { id: contact.id },
        data: { lastMessageAt: new Date(), updatedAt: new Date() },
      })
      const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
      await sync.syncConversationMessage(
        tenantId,
        contact.id,
        { id: savedMessage.id, role, type, content, createdAt: savedMessage.createdAt, metadata: metadata ?? undefined },
        { name: contact.name, phone: contact.phone, status: contact.status, photoUrl: contact.photoUrl ?? undefined },
      )
      return
    }
    const lastOutgoing = await fastify.db.message.findFirst({
      where: { tenantId, role: { in: ['OPERATOR', 'AGENT'] } },
      orderBy: { createdAt: 'desc' },
      select: { contactId: true },
    })
    if (lastOutgoing) {
      const contact = await fastify.db.contact.findUnique({
        where: { id: lastOutgoing.contactId },
        select: { id: true, phone: true, name: true, status: true, photoUrl: true },
      })
      if (contact) {
        const extracted = extractContent(payload)
        if (extracted) {
          const { content, type, metadata } = extracted
          const role = 'OPERATOR'
          const savedMessage = await fastify.db.message.create({
            data: {
              tenantId,
              contactId: contact.id,
              role,
              type,
              content,
              metadata: metadata ? (metadata as object) : undefined,
              zapiMessageId,
              sessionId: payload.zapiConversationId,
            },
          })
          await fastify.db.contact.update({
            where: { id: contact.id },
            data: { lastMessageAt: new Date(), zapiChatLid: chatLid, updatedAt: new Date() },
          })
          const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
          await sync.syncConversationMessage(
            tenantId,
            contact.id,
            { id: savedMessage.id, role, type, content, createdAt: savedMessage.createdAt, metadata: metadata ?? undefined },
            { name: contact.name, phone: contact.phone, status: contact.status, photoUrl: contact.photoUrl ?? undefined },
          )
        }
        return
      }
    }
    fastify.log.debug({ phone, chatLid }, 'zapi:received:fromMe_lid_skip_no_contact')
    return
  }

  const chatLidToStore =
    payload.chatLid ?? (isLid(phone) ? phone : null) ?? (payload.senderLid ?? null)

  const contact = await fastify.db.contact.upsert({
    where: { tenantId_phone: { tenantId, phone } },
    update: {
      ...(contactName && !payload.fromMe && { name: contactName }),
      ...(chatLidToStore && { zapiChatLid: chatLidToStore }),
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      tenantId,
      phone,
      name: contactName,
      photoUrl: senderPhoto,
      zapiChatLid: chatLidToStore,
      status: 'NEW_LEAD',
      lastMessageAt: new Date(),
    },
    select: {
      id: true,
      phone: true,
      name: true,
      status: true,
      photoUrl: true,
    },
  })

  // Enfileira sync de foto em background se:
  // 1. O contato tem foto no WhatsApp (senderPhoto presente), E
  // 2. A foto ainda não foi migrada para o Firebase Storage (não começa com storage.googleapis.com)
  const needsPhotoSync = senderPhoto && !contact.photoUrl?.startsWith('https://storage.googleapis.com')
  if (needsPhotoSync) {
    await photoSyncQueue.add(
      'sync-photo',
      { tenantId, contactId: contact.id },
      // jobId único por contato — evita filas duplicadas para o mesmo contato
      { jobId: `photo:${contact.id}`, delay: 2000 },
    )
  }

  const { content, type, metadata } = extracted
  const role = payload.fromMe ? 'OPERATOR' : 'CONTACT'

  fastify.log.info(
    { contactId: contact.id, tenantId, type, zapiMessageId, role },
    'zapi:received:processing',
  )

  const savedMessage = await fastify.db.message.create({
    data: {
      tenantId,
      contactId: contact.id,
      role,
      type,
      content,
      metadata: metadata ? (metadata as object) : undefined,
      zapiMessageId,
      sessionId: payload.zapiConversationId,
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncConversationMessage(
    tenantId,
    contact.id,
    {
      id: savedMessage.id,
      role,
      type,
      content,
      createdAt: savedMessage.createdAt,
      metadata: metadata ?? undefined,
    },
    {
      name: contact.name,
      phone: contact.phone,
      status: contact.status,
      photoUrl: senderPhoto ?? contact.photoUrl ?? undefined,
    },
  )

  // Apenas mensagens do contato disparam o agente — e só se estiver habilitado
  if (!payload.fromMe) {
    const tenant = await fastify.db.tenant.findUnique({
      where: { id: tenantId },
      select: { isAgentEnabledForWhatsApp: true },
    })
    if (!tenant?.isAgentEnabledForWhatsApp) {
      fastify.log.debug({ tenantId }, 'zapi:received:agent_disabled_for_whatsapp')
      return
    }

    const job = await agentQueue.add(
      'process-message',
      {
        tenantId,
        contactId: contact.id,
        messageContent: content,
        messageType: type,
        messageMetadata: metadata,
        zapiMessageId,
        sessionId: payload.zapiConversationId,
        referenceMessageId: payload.referenceMessageId ?? null,
      },
      { jobId: `agent:${contact.id}:${zapiMessageId}` },
    )

    fastify.log.info(
      { jobId: job.id, contactId: contact.id, type },
      'zapi:received:job_enqueued',
    )
  }
}

// ── 2. DeliveryCallback — confirmação de que a mensagem foi enviada ─────────

async function handleDelivery(fastify: FastifyInstance, payload: ZapiDeliveryPayload) {
  const zapiMessageId = payload.messageId ?? payload.zaapId
  if (!zapiMessageId || !payload.instanceId) return

  fastify.log.debug(
    { zapiMessageId, phone: payload.phone },
    'zapi:delivery:sent',
  )

  const integration = await findTenantByInstance(fastify, payload.instanceId)
  if (!integration) return

  const message = await fastify.db.message.findFirst({
    where: { zapiMessageId, tenantId: integration.tenantId },
    select: { id: true, contactId: true },
  })
  if (!message) return

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.updateMessageStatus(
    integration.tenantId,
    message.contactId,
    message.id,
    'SENT',
  )
}

// ── 3. MessageStatusCallback — RECEIVED, READ, PLAYED ──────────────────────

async function handleMessageStatus(fastify: FastifyInstance, payload: ZapiMessageStatusPayload) {
  if (!payload.ids?.length || !payload.instanceId) return

  fastify.log.debug(
    { status: payload.status, ids: payload.ids, phone: payload.phone },
    'zapi:message_status:update',
  )

  const integration = await findTenantByInstance(fastify, payload.instanceId)
  if (!integration) return

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)

  for (const zapiMessageId of payload.ids) {
    const message = await fastify.db.message.findFirst({
      where: { zapiMessageId, tenantId: integration.tenantId },
      select: { id: true, contactId: true },
    })
    if (!message) continue

    await sync.updateMessageStatus(
      integration.tenantId,
      message.contactId,
      message.id,
      payload.status,
    )
  }
}

// ── 4. DisconnectedCallback — instância desconectou do WhatsApp ─────────────

async function handleDisconnected(fastify: FastifyInstance, payload: ZapiDisconnectedPayload) {
  if (!payload.instanceId) return

  fastify.log.warn(
    { instanceId: payload.instanceId, error: payload.error },
    'zapi:disconnected:instance_offline',
  )

  const integration = await findTenantByInstance(fastify, payload.instanceId)
  if (!integration) return

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncInstanceStatus(integration.tenantId, false, payload.error)
}

// ── 5. ConnectedCallback — instância conectou ao WhatsApp ───────────────────

async function handleConnected(fastify: FastifyInstance, payload: ZapiConnectedPayload) {
  if (!payload.instanceId) return

  fastify.log.info(
    { instanceId: payload.instanceId, phone: payload.phone },
    'zapi:connected:instance_online',
  )

  const integration = await findTenantByInstance(fastify, payload.instanceId)
  if (!integration) return

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncInstanceStatus(integration.tenantId, true)
}

// ── 6. PresenceChatCallback — indicador de digitação do contato ─────────────

async function handlePresence(fastify: FastifyInstance, payload: ZapiPresencePayload) {
  if (!payload.instanceId || !payload.phone) return

  const isTyping = payload.status === 'COMPOSING' || payload.status === 'RECORDING'

  const integration = await findTenantByInstance(fastify, payload.instanceId)
  if (!integration) return

  const contact = await fastify.db.contact.findFirst({
    where: { tenantId: integration.tenantId, phone: payload.phone },
    select: { id: true },
  })
  if (!contact) return

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.setContactTyping(integration.tenantId, contact.id, isTyping)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rota — endpoint único, despacha por payload.type
// ═══════════════════════════════════════════════════════════════════════════════

export async function zapiWebhookRoutes(fastify: FastifyInstance) {
  fastify.post('/zapi', async (request, reply) => {
    reply.status(200).send({ ok: true })

    const payload = request.body as ZapiPayload

    // info para ser visível em prod (LOG_LEVEL=info)
    fastify.log.info(
      { type: payload.type, instanceId: payload.instanceId },
      'zapi:webhook:received',
    )

    switch (payload.type) {
      case 'ReceivedCallback':
        return handleReceived(fastify, payload as ZapiReceivedPayload)

      case 'DeliveryCallback':
        return handleDelivery(fastify, payload as ZapiDeliveryPayload)

      case 'MessageStatusCallback':
        return handleMessageStatus(fastify, payload as ZapiMessageStatusPayload)

      case 'DisconnectedCallback':
        return handleDisconnected(fastify, payload as ZapiDisconnectedPayload)

      case 'ConnectedCallback':
        return handleConnected(fastify, payload as ZapiConnectedPayload)

      case 'PresenceChatCallback':
        return handlePresence(fastify, payload as ZapiPresencePayload)

      default:
        fastify.log.debug({ type: payload.type }, 'zapi:webhook:unhandled_type')
    }
  })
}
