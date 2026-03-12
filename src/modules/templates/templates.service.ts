import type { PrismaClient } from '../../generated/prisma/client.js'
import type { TemplateType } from '../../generated/prisma/client.js'

export async function listTemplates(db: PrismaClient, tenantId: string) {
  return db.messageTemplate.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
  })
}

export async function getTemplateById(db: PrismaClient, tenantId: string, id: string) {
  return db.messageTemplate.findFirst({
    where: { id, tenantId },
  })
}

export async function getTemplateByKey(db: PrismaClient, tenantId: string, key: string) {
  return db.messageTemplate.findFirst({
    where: { tenantId, key },
  })
}

export async function createTemplate(
  db: PrismaClient,
  tenantId: string,
  body: {
    key: string
    name: string
    description?: string
    type: TemplateType
    body: string
    mediaUrl?: string
    caption?: string
    fileName?: string
    variables?: string[]
  },
) {
  return db.messageTemplate.create({
    data: {
      tenantId,
      key: body.key,
      name: body.name,
      description: body.description,
      type: body.type,
      body: body.body,
      mediaUrl: body.mediaUrl,
      caption: body.caption,
      fileName: body.fileName,
      variables: body.variables ?? [],
    },
  })
}

export async function updateTemplate(
  db: PrismaClient,
  tenantId: string,
  id: string,
  body: Partial<{
    name: string
    description: string
    type: TemplateType
    body: string
    mediaUrl: string
    caption: string
    fileName: string
    variables: string[]
  }>,
) {
  return db.messageTemplate.update({
    where: { id, tenantId },
    data: body,
  })
}

export async function deleteTemplate(db: PrismaClient, tenantId: string, id: string) {
  return db.messageTemplate.delete({
    where: { id, tenantId },
  })
}
