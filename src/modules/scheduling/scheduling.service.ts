import type { PrismaClient } from '../../generated/prisma/client.js'
import type { FastifyInstance } from 'fastify'
import { FirebaseSyncService } from '../../services/firebase-sync.service.js'
import { mergeAvailabilityForDay } from '../../utils/availability-merge.js'

export async function listAppointments(
  db: PrismaClient,
  tenantId: string,
  query: {
    page?: number
    limit?: number
    professionalId?: string
    status?: string
    from?: string
    to?: string
    contactId?: string
  },
  requestingRole: string,
  requestingProfessionalId: string | null,
) {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const skip = (page - 1) * limit

  const where = {
    tenantId,
    ...(query.professionalId && { professionalId: query.professionalId }),
    ...(query.contactId && { contactId: query.contactId }),
    ...(query.status && { status: query.status as never }),
    ...(query.from || query.to
      ? {
          scheduledAt: {
            ...(query.from && { gte: new Date(query.from) }),
            ...(query.to && { lte: new Date(query.to + 'T23:59:59') }),
          },
        }
      : {}),
    // Professionals only see their own appointments
    ...(requestingRole === 'PROFESSIONAL' && requestingProfessionalId
      ? { professionalId: requestingProfessionalId }
      : {}),
  }

  const [data, total] = await Promise.all([
    db.appointment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { scheduledAt: 'asc' },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        professional: { select: { id: true, fullName: true } },
        service: { select: { id: true, name: true, durationMin: true } },
        charge: { select: { id: true, status: true, amount: true } },
      },
    }),
    db.appointment.count({ where }),
  ])

  return { data, total, page, limit, pages: Math.ceil(total / limit) }
}

export async function getAppointmentById(
  db: PrismaClient,
  tenantId: string,
  id: string,
) {
  return db.appointment.findFirst({
    where: { id, tenantId },
    include: {
      contact: true,
      professional: { select: { id: true, fullName: true, specialty: true } },
      service: true,
      charge: true,
    },
  })
}

export async function createAppointment(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  memberId: string,
  body: {
    contactId: string
    professionalId: string
    serviceId: string
    scheduledAt: string
    durationMin?: number
    notes?: string
  },
) {
  const scheduledAt = new Date(body.scheduledAt)

  const service = await db.service.findFirst({
    where: { id: body.serviceId, tenantId },
  })
  if (!service) throw fastify.httpErrors.notFound('Service not found')

  const durationMin = body.durationMin ?? service.durationMin
  const conflictEnd = new Date(scheduledAt.getTime() + durationMin * 60_000)

  const conflict = await db.appointment.findFirst({
    where: {
      professionalId: body.professionalId,
      status: { in: ['PENDING', 'CONFIRMED'] },
      AND: [
        { scheduledAt: { lt: conflictEnd } },
        { scheduledAt: { gte: new Date(scheduledAt.getTime() - durationMin * 60_000) } },
      ],
    },
  })

  if (conflict) {
    throw fastify.httpErrors.badRequest('Time slot is unavailable — scheduling conflict')
  }

  const appointment = await db.appointment.create({
    data: {
      tenantId,
      contactId: body.contactId,
      professionalId: body.professionalId,
      serviceId: body.serviceId,
      scheduledAt,
      durationMin,
      notes: body.notes,
      createdBy: memberId,
    },
    include: {
      contact: { select: { id: true, name: true, phone: true } },
      professional: { select: { fullName: true } },
      service: { select: { name: true } },
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncAppointment(tenantId, {
    id: appointment.id,
    contactId: appointment.contactId,
    professionalId: appointment.professionalId,
    serviceId: appointment.serviceId,
    scheduledAt: appointment.scheduledAt,
    durationMin: appointment.durationMin,
    status: appointment.status,
    notes: appointment.notes,
  })

  return appointment
}

export async function updateAppointment(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  id: string,
  body: {
    status?: string
    scheduledAt?: string
    notes?: string
    cancelledReason?: string
  },
) {
  const appointment = await db.appointment.update({
    where: { id, tenantId },
    data: {
      ...(body.status && { status: body.status as never }),
      ...(body.scheduledAt && { scheduledAt: new Date(body.scheduledAt) }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.cancelledReason !== undefined && { cancelledReason: body.cancelledReason }),
      updatedAt: new Date(),
    },
  })

  const sync = new FirebaseSyncService(fastify.firebase.firestore, fastify.log)
  await sync.syncAppointment(tenantId, {
    id: appointment.id,
    contactId: appointment.contactId,
    professionalId: appointment.professionalId,
    serviceId: appointment.serviceId,
    scheduledAt: appointment.scheduledAt,
    durationMin: appointment.durationMin,
    status: appointment.status,
    notes: appointment.notes,
  })

  return appointment
}

export async function cancelAppointment(
  db: PrismaClient,
  fastify: FastifyInstance,
  tenantId: string,
  id: string,
) {
  return updateAppointment(db, fastify, tenantId, id, { status: 'CANCELLED', cancelledReason: 'Cancelled by operator' })
}

export async function getProfessionalAvailability(
  db: PrismaClient,
  tenantId: string,
  professionalId: string,
  date: string,
  serviceId: string,
) {
  const targetDate = new Date(date + 'T00:00:00')
  const dayOfWeek = targetDate.getDay()
  const nextDay = new Date(targetDate.getTime() + 86_400_000)

  const [professional, availability, overrides, exceptions, blockRanges, service, existingAppointments] =
    await Promise.all([
      db.professional.findFirst({ where: { id: professionalId, tenantId } }),
      db.professionalAvailability.findMany({
        where: { professionalId, dayOfWeek },
      }),
      db.availabilityOverride.findMany({
        where: { professionalId, date: targetDate },
      }),
      db.availabilityException.findMany({
        where: { professionalId, date: targetDate },
      }),
      db.availabilityBlockRange.findMany({
        where: {
          professionalId,
          dateFrom: { lte: targetDate },
          dateTo: { gte: targetDate },
        },
      }),
      db.service.findFirst({ where: { id: serviceId, tenantId } }),
      db.appointment.findMany({
        where: {
          professionalId,
          status: { in: ['PENDING', 'CONFIRMED'] },
          scheduledAt: { gte: targetDate, lt: nextDay },
        },
        select: { scheduledAt: true, durationMin: true },
      }),
    ])

  if (!professional) return null
  const fullBlockException = exceptions.find((e) => e.isUnavailable)
  if (fullBlockException) return { slots: [], reason: 'Profissional indisponível nesta data' }
  if (blockRanges.length > 0) return { slots: [], reason: 'Profissional indisponível nesta data' }

  const weekly = availability.map((a) => ({
    startTime: a.startTime,
    endTime: a.endTime,
    slotDurationMin: a.slotDurationMin ?? 50,
  }))
  const overrideWindows = overrides.map((o) => ({
    startTime: o.startTime,
    endTime: o.endTime,
    slotDurationMin: o.slotDurationMin ?? 50,
  }))
  const availabilitySource = mergeAvailabilityForDay(weekly, overrideWindows)

  if (availabilitySource.length === 0) return { slots: [], reason: 'Sem disponibilidade neste dia da semana' }

  const slotDuration = service?.durationMin ?? 50
  const slots: { time: string; endTime: string; scheduledAt: string }[] = []

  const bookedMinutes = new Set<number>()
  for (const appt of existingAppointments) {
    const start = appt.scheduledAt.getHours() * 60 + appt.scheduledAt.getMinutes()
    for (let m = start; m < start + appt.durationMin; m++) {
      bookedMinutes.add(m)
    }
  }

  for (const e of exceptions) {
    if (e.isUnavailable || !e.slotMask) continue
    const arr = Array.isArray(e.slotMask) ? e.slotMask : []
    for (const w of arr) {
      const slot = w as { startTime?: string; endTime?: string } | null
      if (slot && typeof slot.startTime === 'string' && typeof slot.endTime === 'string') {
        const [sh, sm] = slot.startTime.split(':').map(Number)
        const [eh, em] = slot.endTime.split(':').map(Number)
        const start = sh * 60 + (sm ?? 0)
        const end = eh * 60 + (em ?? 0)
        for (let m = start; m < end; m++) bookedMinutes.add(m)
      }
    }
  }

  for (const avail of availabilitySource) {
    const [sh, sm] = avail.startTime.split(':').map(Number)
    const [eh, em] = avail.endTime.split(':').map(Number)
    let current = sh! * 60 + (sm ?? 0)
    const end = eh! * 60 + (em ?? 0)

    while (current + slotDuration <= end) {
      const isFree = !Array.from({ length: slotDuration }, (_, i) => current + i).some((m) =>
        bookedMinutes.has(m),
      )

      if (isFree) {
        const hh = Math.floor(current / 60)
        const mm = current % 60
        const ehh = Math.floor((current + slotDuration) / 60)
        const emm = (current + slotDuration) % 60

        const slotDate = new Date(targetDate)
        slotDate.setHours(hh, mm, 0, 0)

        slots.push({
          time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
          endTime: `${String(ehh).padStart(2, '0')}:${String(emm).padStart(2, '0')}`,
          scheduledAt: slotDate.toISOString(),
        })
      }

      current += avail.slotDurationMin
    }
  }

  return { slots, professional: { id: professional.id, fullName: professional.fullName } }
}
