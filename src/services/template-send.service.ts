import type { PrismaClient } from '../generated/prisma/client.js'
import type { MessageTemplate } from '../generated/prisma/client.js'
import type { FastifyBaseLogger } from 'fastify'
import { interpolateTemplate } from './template-render.service.js'
import { getZapiConfig, sendText, sendImage, sendAudio, sendVideo, sendDocument } from './zapi.service.js'
import { FirebaseSyncService } from './firebase-sync.service.js'

const PLAYGROUND_PHONE = '__playground__'

export interface TemplateContext {
  name?: string | null
  appointmentTime?: string | null
  appointmentDate?: string | null
  appointmentTimeOnly?: string | null
  professionalName?: string | null
  serviceName?: string | null
  [key: string]: string | null | undefined
}

export function renderTemplate(
  template: MessageTemplate,
  context: TemplateContext,
): { type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT'; body: string; mediaUrl?: string; caption?: string; fileName?: string } {
  const vars: Record<string, string | null | undefined> = {
    name: context.name ?? 'paciente',
    appointmentTime: context.appointmentTime ?? '',
    appointmentDate: context.appointmentDate ?? '',
    appointmentTimeOnly: context.appointmentTimeOnly ?? '',
    professionalName: context.professionalName ?? '',
    serviceName: context.serviceName ?? '',
    ...context,
  }

  const body = interpolateTemplate(template.body, vars)
  const caption = template.caption ? interpolateTemplate(template.caption, vars) : undefined
  const mediaUrl = template.mediaUrl ? interpolateTemplate(template.mediaUrl, vars) : undefined
  const fileName = template.fileName ? interpolateTemplate(template.fileName, vars) : undefined

  return {
    type: template.type as 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT',
    body,
    mediaUrl: mediaUrl || undefined,
    caption: caption || undefined,
    fileName: fileName || undefined,
  }
}

export interface SendTemplateOptions {
  skipWhatsApp?: boolean
}

export async function sendTemplateMessage(
  db: PrismaClient,
  firestore: ReturnType<typeof import('firebase-admin/firestore').getFirestore> | null,
  logger: FastifyBaseLogger,
  tenantId: string,
  contactId: string,
  contactPhone: string,
  template: MessageTemplate,
  context: TemplateContext,
  metadata: Record<string, unknown>,
  options: SendTemplateOptions = {},
): Promise<{ id: string }> {
  const rendered = renderTemplate(template, context)
  const isPlayground = contactPhone === PLAYGROUND_PHONE
  const skipWhatsApp = options.skipWhatsApp ?? isPlayground

  let content = rendered.body
  let messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' = 'TEXT'

  if (!skipWhatsApp) {
    const zapiConfig = await getZapiConfig(tenantId, db)
    if (zapiConfig) {
      const { instanceId, clientToken } = zapiConfig
      switch (rendered.type) {
        case 'TEXT':
          await sendText(instanceId, clientToken, contactPhone, rendered.body)
          break
        case 'IMAGE':
          if (!rendered.mediaUrl) throw new Error('Template IMAGE requires mediaUrl')
          await sendImage(instanceId, clientToken, contactPhone, rendered.mediaUrl, rendered.caption)
          content = rendered.caption || '[Imagem]'
          messageType = 'IMAGE'
          break
        case 'AUDIO':
          if (!rendered.mediaUrl) throw new Error('Template AUDIO requires mediaUrl')
          await sendAudio(instanceId, clientToken, contactPhone, rendered.mediaUrl)
          content = '[Áudio]'
          messageType = 'AUDIO'
          break
        case 'VIDEO':
          if (!rendered.mediaUrl) throw new Error('Template VIDEO requires mediaUrl')
          await sendVideo(instanceId, clientToken, contactPhone, rendered.mediaUrl, rendered.caption)
          content = rendered.caption || '[Vídeo]'
          messageType = 'TEXT'
          break
        case 'DOCUMENT':
          if (!rendered.mediaUrl) throw new Error('Template DOCUMENT requires mediaUrl')
          await sendDocument(
            instanceId,
            clientToken,
            contactPhone,
            rendered.mediaUrl,
            rendered.fileName || 'document',
          )
          content = rendered.caption || '[Documento]'
          messageType = 'DOCUMENT'
          break
        default:
          await sendText(instanceId, clientToken, contactPhone, rendered.body)
      }
    }
  }

  const saved = await db.message.create({
    data: {
      tenantId,
      contactId,
      role: 'AGENT',
      type: messageType,
      content,
      metadata: { ...metadata, templateId: template.id, templateKey: template.key },
    },
  })

  const sync = new FirebaseSyncService(firestore, logger)
  await sync.syncConversationMessage(tenantId, contactId, {
    id: saved.id,
    role: 'AGENT',
    type: messageType,
    content,
    createdAt: saved.createdAt,
  })

  return { id: saved.id }
}
