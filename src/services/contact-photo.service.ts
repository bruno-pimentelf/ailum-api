import type { PrismaClient } from '../generated/prisma/client.js'
import type { Storage } from 'firebase-admin/storage'
import type { Firestore } from 'firebase-admin/firestore'
import type { FastifyBaseLogger } from 'fastify'
import { getZapiConfig } from './zapi.service.js'
import { env } from '../config/env.js'

// Busca URL temporária da foto via Z-API
async function fetchZapiPhotoUrl(
  instanceId: string,
  instanceToken: string,
  phone: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/profile-picture?phone=${phone}`,
    { headers: { 'client-token': env.ZAPI_WEBHOOK_TOKEN } },
  )
  if (!res.ok) return null
  const data = (await res.json()) as Array<{ link?: string }> | { link?: string }
  // Z-API retorna array ou objeto dependendo da versão
  const item = Array.isArray(data) ? data[0] : data
  return item?.link ?? null
}

// Faz download da imagem e sobe para o Firebase Storage
// Retorna a URL pública permanente
async function uploadPhotoToStorage(
  storage: Storage,
  tenantId: string,
  contactId: string,
  imageUrl: string,
): Promise<string> {
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`)

  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const ext = contentType.includes('png') ? 'png' : 'jpg'
  const buffer = Buffer.from(await res.arrayBuffer())

  const bucket = storage.bucket()
  const filePath = `tenants/${tenantId}/contacts/${contactId}/photo.${ext}`
  const file = bucket.file(filePath)

  await file.save(buffer, {
    metadata: { contentType },
    // público para leitura — URL não expira
    predefinedAcl: 'publicRead',
  })

  // URL pública estável do Firebase Storage
  return `https://storage.googleapis.com/${bucket.name}/${filePath}`
}

// ─── Função principal ─────────────────────────────────────────────────────────
// Busca, faz download, persiste no Storage e atualiza Postgres + Firestore

export async function syncContactPhoto(
  db: PrismaClient,
  storage: Storage | null,
  firestore: Firestore | null,
  logger: FastifyBaseLogger,
  tenantId: string,
  contactId: string,
): Promise<string | null> {
  if (!storage) {
    logger.warn({ contactId }, 'contact-photo:storage_not_configured')
    return null
  }

  // Busca contato
  const contact = await db.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { id: true, phone: true, photoUrl: true },
  })
  if (!contact) return null

  // Busca credenciais Z-API
  const zapiConfig = await getZapiConfig(tenantId, db)
  if (!zapiConfig) return null

  // Busca URL temporária na Z-API
  const tempUrl = await fetchZapiPhotoUrl(zapiConfig.instanceId, zapiConfig.clientToken, contact.phone)
  if (!tempUrl) {
    logger.debug({ contactId, phone: contact.phone }, 'contact-photo:no_photo_on_zapi')
    return null
  }

  try {
    // Faz upload para Firebase Storage
    const permanentUrl = await uploadPhotoToStorage(storage, tenantId, contactId, tempUrl)

    // Salva no Postgres
    await db.contact.update({
      where: { id: contactId },
      data: { photoUrl: permanentUrl, updatedAt: new Date() },
    })

    // Sincroniza no Firestore
    if (firestore) {
      await firestore
        .collection('tenants').doc(tenantId)
        .collection('contacts').doc(contactId)
        .set({ photoUrl: permanentUrl }, { merge: true })
    }

    logger.info({ contactId, permanentUrl }, 'contact-photo:synced')
    return permanentUrl
  } catch (err) {
    logger.error({ err, contactId }, 'contact-photo:upload_failed')
    return null
  }
}
