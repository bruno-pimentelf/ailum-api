import type { PrismaClient } from '../../generated/prisma/client.js'

export async function listProfessionals(db: PrismaClient, tenantId: string) {
  return db.professional.findMany({
    where: { tenantId, isActive: true },
    orderBy: { fullName: 'asc' },
    include: {
      voice: { select: { id: true, name: true, provider: true } },
      professionalServices: { include: { service: { select: { id: true, name: true, price: true } } } },
    },
  })
}

export async function getProfessionalById(db: PrismaClient, tenantId: string, id: string) {
  return db.professional.findFirst({
    where: { id, tenantId, isActive: true },
    include: {
      voice: true,
      professionalServices: { include: { service: true } },
      availability: { orderBy: { dayOfWeek: 'asc' } },
      availabilityExceptions: { orderBy: { date: 'asc' }, take: 30 },
    },
  })
}

export async function createProfessional(
  db: PrismaClient,
  tenantId: string,
  body: {
    fullName: string
    specialty?: string
    bio?: string
    avatarUrl?: string
    voiceId?: string
    calendarColor?: string
  },
) {
  return db.professional.create({
    data: { tenantId, ...body },
  })
}

export async function updateProfessional(
  db: PrismaClient,
  tenantId: string,
  id: string,
  body: Partial<{
    fullName: string
    specialty: string
    bio: string
    avatarUrl: string
    voiceId: string
    calendarColor: string
  }>,
) {
  return db.professional.update({ where: { id, tenantId }, data: body })
}

export async function deactivateProfessional(db: PrismaClient, tenantId: string, id: string) {
  return db.professional.update({ where: { id, tenantId }, data: { isActive: false } })
}

// ─── Availability ─────────────────────────────────────────────────────────────

export async function getProfessionalAvailabilitySchedule(
  db: PrismaClient,
  tenantId: string,
  id: string,
) {
  await db.professional.findFirstOrThrow({ where: { id, tenantId } })
  return db.professionalAvailability.findMany({
    where: { professionalId: id },
    orderBy: { dayOfWeek: 'asc' },
  })
}

export async function setProfessionalAvailability(
  db: PrismaClient,
  tenantId: string,
  id: string,
  slots: Array<{
    dayOfWeek: number
    startTime: string
    endTime: string
    slotDurationMin?: number
  }>,
) {
  await db.professional.findFirstOrThrow({ where: { id, tenantId } })

  await db.professionalAvailability.deleteMany({ where: { professionalId: id } })

  if (slots.length === 0) return []

  await db.professionalAvailability.createMany({
    data: slots.map((s) => ({
      professionalId: id,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      slotDurationMin: s.slotDurationMin ?? 50,
    })),
  })

  return db.professionalAvailability.findMany({
    where: { professionalId: id },
    orderBy: { dayOfWeek: 'asc' },
  })
}

// ─── Exceptions ───────────────────────────────────────────────────────────────

export async function addAvailabilityException(
  db: PrismaClient,
  tenantId: string,
  professionalId: string,
  body: { date: string; isUnavailable?: boolean; reason?: string },
) {
  await db.professional.findFirstOrThrow({ where: { id: professionalId, tenantId } })
  const dateObj = new Date(body.date + 'T00:00:00')
  return db.availabilityException.create({
    data: {
      professionalId,
      date: dateObj,
      isUnavailable: body.isUnavailable ?? true,
      reason: body.reason,
    },
  })
}

export async function removeAvailabilityException(
  db: PrismaClient,
  tenantId: string,
  professionalId: string,
  date: string,
) {
  await db.professional.findFirstOrThrow({ where: { id: professionalId, tenantId } })
  const dateObj = new Date(date + 'T00:00:00')
  return db.availabilityException.deleteMany({
    where: { professionalId, date: dateObj },
  })
}

// ─── Services ────────────────────────────────────────────────────────────────

export async function associateProfessionalService(
  db: PrismaClient,
  tenantId: string,
  professionalId: string,
  serviceId: string,
  customPrice?: number,
) {
  await db.professional.findFirstOrThrow({ where: { id: professionalId, tenantId } })
  await db.service.findFirstOrThrow({ where: { id: serviceId, tenantId } })

  return db.professionalService.upsert({
    where: { professionalId_serviceId: { professionalId, serviceId } },
    create: { professionalId, serviceId, customPrice: customPrice ?? null },
    update: { customPrice: customPrice ?? null },
  })
}

export async function disassociateProfessionalService(
  db: PrismaClient,
  tenantId: string,
  professionalId: string,
  serviceId: string,
) {
  await db.professional.findFirstOrThrow({ where: { id: professionalId, tenantId } })
  return db.professionalService.delete({
    where: { professionalId_serviceId: { professionalId, serviceId } },
  })
}
