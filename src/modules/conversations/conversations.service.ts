import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyBaseLogger } from 'fastify'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'
import {
  getZapiConfig,
  sendText,
  sendImage,
  sendAudio,
  sendVideo,
  sendDocument,
  sendSticker,
  sendLocation,
  sendContact,
  sendReaction,
} from '../../services/zapi.service.js'
import type { Firestore } from 'firebase-admin/firestore'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SendMessageInput {
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION' | 'CONTACT' | 'REACTION'
  text?: string
  mediaUrl?: string
  caption?: string
  fileName?: string
  latitude?: string
  longitude?: string
  locationTitle?: string
  locationAddress?: string
  contactName?: string
  contactPhone?: string
  reaction?: string
  replyToZapiMessageId?: string
}

// ─── Listar mensagens ─────────────────────────────────────────────────────────

export async function listMessages(
  db: PrismaClient,
  tenantId: string,
  contactId: string,
  limit = 50,
  before?: string,
) {
  return db.message.findMany({
    where: {
      tenantId,
      contactId,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      role: true,
      type: true,
      content: true,
      metadata: true,
      zapiMessageId: true,
      createdAt: true,
    },
  })
}

// ─── Enviar mensagem (operador → contato) ────────────────────────────────────

export async function sendOperatorMessage(
  db: PrismaClient,
  firestore: Firestore | null,
  logger: FastifyBaseLogger,
  tenantId: string,
  contactId: string,
  operatorId: string,
  input: SendMessageInput,
): Promise<{ id: string }> {
  // Busca o contato para pegar o telefone
  const contact = await db.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { id: true, phone: true, name: true, status: true },
  })
  if (!contact) throw new Error('Contact not found')

  // Busca credenciais Z-API do tenant
  const zapiConfig = await getZapiConfig(tenantId, db)
  if (!zapiConfig) throw new Error('Z-API integration not configured')

  const { instanceId, clientToken } = zapiConfig
  const phone = contact.phone
  const instanceToken = clientToken

  let zapiMessageId: string | undefined
  let content = ''
  let messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' = 'TEXT'
  let metadata: Record<string, unknown> | null = null

  // Despacha para o método correto da Z-API
  switch (input.type) {
    case 'TEXT': {
      if (!input.text) throw new Error('text é obrigatório para tipo TEXT')
      const res = await sendText(instanceId, instanceToken, phone, input.text)
      zapiMessageId = res.messageId ?? res.zapiId
      content = input.text
      messageType = 'TEXT'
      break
    }

    case 'IMAGE': {
      if (!input.mediaUrl) throw new Error('mediaUrl é obrigatório para tipo IMAGE')
      const res = await sendImage(instanceId, instanceToken, phone, input.mediaUrl, input.caption)
      zapiMessageId = res.messageId ?? res.zapiId
      content = input.caption || '[Imagem]'
      messageType = 'IMAGE'
      metadata = { imageUrl: input.mediaUrl, caption: input.caption }
      break
    }

    case 'AUDIO': {
      if (!input.mediaUrl) throw new Error('mediaUrl é obrigatório para tipo AUDIO')
      const res = await sendAudio(instanceId, instanceToken, phone, input.mediaUrl)
      zapiMessageId = res.messageId ?? res.zapiId
      content = '[Áudio]'
      messageType = 'AUDIO'
      metadata = { audioUrl: input.mediaUrl }
      break
    }

    case 'VIDEO': {
      if (!input.mediaUrl) throw new Error('mediaUrl é obrigatório para tipo VIDEO')
      const res = await sendVideo(instanceId, instanceToken, phone, input.mediaUrl, input.caption)
      zapiMessageId = res.messageId ?? res.zapiId
      content = input.caption || '[Vídeo]'
      messageType = 'DOCUMENT'
      metadata = { videoUrl: input.mediaUrl, caption: input.caption, mediaKind: 'video' }
      break
    }

    case 'DOCUMENT': {
      if (!input.mediaUrl) throw new Error('mediaUrl é obrigatório para tipo DOCUMENT')
      const res = await sendDocument(instanceId, instanceToken, phone, input.mediaUrl, input.fileName ?? 'documento')
      zapiMessageId = res.messageId ?? res.zapiId
      content = `[Arquivo: ${input.fileName ?? 'documento'}]`
      messageType = 'DOCUMENT'
      metadata = { documentUrl: input.mediaUrl, fileName: input.fileName }
      break
    }

    case 'STICKER': {
      if (!input.mediaUrl) throw new Error('mediaUrl é obrigatório para tipo STICKER')
      const res = await sendSticker(instanceId, instanceToken, phone, input.mediaUrl)
      zapiMessageId = res.messageId ?? res.zapiId
      content = '[Figurinha]'
      messageType = 'TEXT'
      metadata = { stickerUrl: input.mediaUrl, mediaKind: 'sticker' }
      break
    }

    case 'LOCATION': {
      if (!input.latitude || !input.longitude || !input.locationTitle || !input.locationAddress) {
        throw new Error('latitude, longitude, locationTitle e locationAddress são obrigatórios')
      }
      const res = await sendLocation(instanceId, instanceToken, phone, input.latitude, input.longitude, input.locationTitle, input.locationAddress)
      zapiMessageId = res.messageId ?? res.zapiId
      content = `[Localização: ${input.locationTitle}]`
      messageType = 'TEXT'
      metadata = { latitude: input.latitude, longitude: input.longitude, address: input.locationAddress, mediaKind: 'location' }
      break
    }

    case 'CONTACT': {
      if (!input.contactName || !input.contactPhone) {
        throw new Error('contactName e contactPhone são obrigatórios')
      }
      const res = await sendContact(instanceId, instanceToken, phone, input.contactName, input.contactPhone)
      zapiMessageId = res.messageId ?? res.zapiId
      content = `[Contato: ${input.contactName}]`
      messageType = 'TEXT'
      metadata = { contactName: input.contactName, contactPhone: input.contactPhone, mediaKind: 'contact' }
      break
    }

    case 'REACTION': {
      if (!input.reaction || !input.replyToZapiMessageId) {
        throw new Error('reaction e replyToZapiMessageId são obrigatórios')
      }
      await sendReaction(instanceId, instanceToken, phone, input.replyToZapiMessageId, input.reaction)
      // Reação não gera registro de mensagem próprio — apenas retorna
      return { id: 'reaction' }
    }
  }

  // Salva no Postgres (audit log)
  const saved = await db.message.create({
    data: {
      tenantId,
      contactId,
      role: 'OPERATOR',
      type: messageType,
      content,
      metadata: metadata ? (metadata as object) : undefined,
      zapiMessageId,
    },
  })

  // Atualiza lastMessageAt do contato
  await db.contact.update({
    where: { id: contactId },
    data: { lastMessageAt: new Date(), updatedAt: new Date() },
  })

  // Sincroniza no Firestore
  const sync = new FirebaseSyncService(firestore, logger)
  await sync.syncConversationMessage(
    tenantId,
    contactId,
    {
      id: saved.id,
      role: 'OPERATOR',
      type: messageType,
      content,
      createdAt: saved.createdAt,
      metadata: metadata ?? undefined,
    },
    {
      name: contact.name,
      phone: contact.phone,
      status: contact.status,
    },
  )

  return { id: saved.id }
}

// ─── Marcar conversa como lida ────────────────────────────────────────────────

export async function markConversationRead(
  db: PrismaClient,
  firestore: Firestore | null,
  logger: FastifyBaseLogger,
  tenantId: string,
  contactId: string,
) {
  const sync = new FirebaseSyncService(firestore, logger)
  await sync.markMessagesRead(tenantId, contactId)
}
