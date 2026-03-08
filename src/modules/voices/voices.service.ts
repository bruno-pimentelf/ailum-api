import type { PrismaClient } from '../../generated/prisma/client.js'

export async function listVoices(db: PrismaClient, tenantId: string) {
  return db.voice.findMany({
    where: { tenantId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  })
}

export async function getVoiceById(db: PrismaClient, tenantId: string, id: string) {
  return db.voice.findFirst({ where: { id, tenantId } })
}

export async function createVoice(
  db: PrismaClient,
  tenantId: string,
  body: {
    name: string
    provider: string
    providerVoiceId: string
    sampleUrl?: string
  },
) {
  return db.voice.create({
    data: {
      tenantId,
      name: body.name,
      provider: body.provider as never,
      providerVoiceId: body.providerVoiceId,
      sampleUrl: body.sampleUrl,
      isDefault: false,
    },
  })
}

export async function updateVoice(
  db: PrismaClient,
  tenantId: string,
  id: string,
  body: { name?: string; sampleUrl?: string | null },
) {
  return db.voice.update({
    where: { id, tenantId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.sampleUrl !== undefined && { sampleUrl: body.sampleUrl }),
    },
  })
}

export async function deleteVoice(db: PrismaClient, tenantId: string, id: string) {
  return db.voice.delete({ where: { id, tenantId } })
}

export async function setDefaultVoice(db: PrismaClient, tenantId: string, id: string) {
  // Unset current default, then set the new one — in a transaction
  return db.$transaction([
    db.voice.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } }),
    db.voice.update({ where: { id, tenantId }, data: { isDefault: true } }),
  ])
}
