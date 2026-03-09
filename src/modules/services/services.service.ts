import type { PrismaClient } from '../../generated/prisma/client.js'

export async function listServices(db: PrismaClient, tenantId: string) {
  return db.service.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: 'asc' },
  })
}

export async function getServiceById(db: PrismaClient, tenantId: string, id: string) {
  return db.service.findFirst({
    where: { id, tenantId },
    include: {
      professionalServices: {
        include: { professional: { select: { id: true, fullName: true, isActive: true } } },
      },
    },
  })
}

export async function createService(
  db: PrismaClient,
  tenantId: string,
  body: {
    name: string
    description?: string
    durationMin?: number
    price: number
    isConsultation?: boolean
  },
) {
  return db.service.create({
    data: {
      tenantId,
      name: body.name,
      description: body.description,
      durationMin: body.durationMin ?? 50,
      price: body.price,
      isConsultation: body.isConsultation ?? true,
    },
  })
}

export async function updateService(
  db: PrismaClient,
  tenantId: string,
  id: string,
  body: Partial<{
    name: string
    description: string
    durationMin: number
    price: number
    isConsultation: boolean
  }>,
) {
  return db.service.update({ where: { id, tenantId }, data: body })
}

export async function deactivateService(db: PrismaClient, tenantId: string, id: string) {
  return db.service.update({ where: { id, tenantId }, data: { isActive: false } })
}
