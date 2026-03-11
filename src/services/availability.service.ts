import type { PrismaClient } from '../generated/prisma/client.js'
import { mergeAvailabilityForDay } from '../utils/availability-merge.js'

export interface AvailabilitySlot {
  time: string
  endTime: string
}

export interface AvailabilityProfessionalService {
  id: string
  name: string
  durationMin: number
  price: number
}

export interface AvailabilityProfessional {
  id: string
  fullName: string
  specialty: string | null
  services: AvailabilityProfessionalService[]
  slots: AvailabilitySlot[]
}

const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const

export interface SearchAvailabilityDiagnostic {
  date: string
  dayOfWeek: number
  dayName: string
  totalProfessionals: number
  professionalsDetail: Array<{
    id: string
    fullName: string
    hasAvailabilityForDay: boolean
    availabilityDays: string[]
    hasConsultationServices: boolean
    serviceCount: number
    hasExceptionForDate: boolean
    exclusionReason?: string
  }>
}

export interface SearchAvailabilityResult {
  date: string
  dateFormatted: string
  professionals: AvailabilityProfessional[]
  /** Quando professionals está vazio, traz contexto para a IA entender o motivo e sugerir ao usuário */
  diagnostic?: SearchAvailabilityDiagnostic
}

/**
 * Calcula horários disponíveis para uma data específica.
 * Reutiliza a mesma lógica do context-builder.
 */
export async function searchAvailability(
  db: PrismaClient,
  tenantId: string,
  dateStr: string,
  options?: { minStartMinutesFromMidnight?: number },
): Promise<SearchAvailabilityResult> {
  const parsed = new Date(dateStr + 'T12:00:00')
  if (Number.isNaN(parsed.getTime())) {
    return { date: dateStr, dateFormatted: dateStr, professionals: [] }
  }

  const dayOfWeek = parsed.getDay()
  const dateStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  const dateEnd = new Date(dateStart.getTime() + 86_400_000)

  const minStart = options?.minStartMinutesFromMidnight

  const professionalsRaw = await db.professional.findMany({
    where: { tenantId, isActive: true },
    include: {
      availability: { where: { dayOfWeek } },
      availabilityExceptions: { where: { date: dateStart } },
      availabilityOverrides: {
        where: { date: dateStart },
      },
      availabilityBlockRanges: {
        where: {
          dateFrom: { lte: dateStart },
          dateTo: { gte: dateStart },
        },
      },
      appointments: {
        where: {
          scheduledAt: { gte: dateStart, lt: dateEnd },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        select: { scheduledAt: true, durationMin: true },
      },
      professionalServices: {
        where: { service: { isActive: true, isConsultation: true } },
        include: {
          service: { select: { id: true, name: true, durationMin: true, price: true } },
        },
      },
    },
  })

  const professionals: AvailabilityProfessional[] = []

  for (const prof of professionalsRaw) {
    const fullBlockException = prof.availabilityExceptions.find((e) => e.isUnavailable)
    if (fullBlockException) continue
    if (prof.availabilityBlockRanges.length > 0) continue

    const slotMaskWindows = collectSlotMaskFromExceptions(prof.availabilityExceptions)

    const weekly = prof.availability.map((a) => ({
      startTime: a.startTime,
      endTime: a.endTime,
      slotDurationMin: a.slotDurationMin ?? 50,
    }))
    const overrides = prof.availabilityOverrides.map((o) => ({
      startTime: o.startTime,
      endTime: o.endTime,
      slotDurationMin: o.slotDurationMin ?? 50,
    }))
    const availabilitySource = mergeAvailabilityForDay(weekly, overrides)

    if (availabilitySource.length === 0) continue

    const services = prof.professionalServices.map((ps) => ({
      id: ps.service.id,
      name: ps.service.name,
      durationMin: ps.service.durationMin,
      price: Number(ps.service.price),
    }))

    if (services.length === 0) continue

    const slots = buildTimeSlotsForDate(
      availabilitySource,
      prof.appointments,
      minStart,
      slotMaskWindows,
    )

    if (slots.length > 0) {
      professionals.push({
        id: prof.id,
        fullName: prof.fullName,
        specialty: prof.specialty,
        services,
        slots,
      })
    }
  }

  const day = String(dateStart.getDate()).padStart(2, '0')
  const month = String(dateStart.getMonth() + 1).padStart(2, '0')
  const year = dateStart.getFullYear()
  const dateFormatted = `${day}/${month}/${year}`

  // Quando não há slots, retorna diagnóstico para a IA explicar ao usuário e sugerir verificação
  let diagnostic: SearchAvailabilityDiagnostic | undefined
  if (professionals.length === 0) {
    const allProfs = await db.professional.findMany({
      where: { tenantId, isActive: true },
      include: {
        availability: true,
        professionalServices: {
          where: { service: { isActive: true, isConsultation: true } },
          select: { serviceId: true },
        },
        availabilityExceptions: {
          where: { date: dateStart },
          select: { isUnavailable: true, reason: true, slotMask: true },
        },
        availabilityOverrides: { where: { date: dateStart }, select: { id: true } },
        availabilityBlockRanges: {
          where: { dateFrom: { lte: dateStart }, dateTo: { gte: dateStart } },
          select: { reason: true },
        },
      },
    })

    diagnostic = {
      date: dateStr,
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      totalProfessionals: allProfs.length,
      professionalsDetail: allProfs.map((p) => {
        const availDays = [...new Set(p.availability.map((a) => DAY_NAMES[a.dayOfWeek]!))]
        const hasAvailForDay =
          p.availability.some((a) => a.dayOfWeek === dayOfWeek) || p.availabilityOverrides.length > 0
        const fullBlock = p.availabilityExceptions.find((e) => e.isUnavailable)
        const blockRange = p.availabilityBlockRanges[0]
        return {
          id: p.id,
          fullName: p.fullName,
          hasAvailabilityForDay: hasAvailForDay,
          availabilityDays: availDays,
          hasConsultationServices: p.professionalServices.length > 0,
          serviceCount: p.professionalServices.length,
          hasExceptionForDate: !!fullBlock,
          exclusionReason:
            fullBlock?.reason ?? blockRange?.reason ?? undefined,
        }
      }),
    }
  }

  return {
    date: dateStr,
    dateFormatted,
    professionals,
    ...(diagnostic && { diagnostic }),
  }
}

function collectSlotMaskFromExceptions(
  exceptions: { isUnavailable: boolean; slotMask: unknown }[],
): Array<{ startTime: string; endTime: string }> {
  const windows: Array<{ startTime: string; endTime: string }> = []
  for (const e of exceptions) {
    if (e.isUnavailable || !e.slotMask) continue
    const arr = Array.isArray(e.slotMask) ? e.slotMask : []
    for (const w of arr) {
      if (w && typeof w === 'object' && typeof w.startTime === 'string' && typeof w.endTime === 'string') {
        windows.push({ startTime: w.startTime, endTime: w.endTime })
      }
    }
  }
  return windows
}

function buildTimeSlotsForDate(
  availability: { startTime: string; endTime: string; slotDurationMin: number }[],
  existingAppointments: { scheduledAt: Date; durationMin: number }[],
  minStartMinutesFromMidnight?: number,
  slotMaskWindows?: Array<{ startTime: string; endTime: string }>,
): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = []
  const bookedMinutes = new Set<number>()

  for (const appt of existingAppointments) {
    const apptStart = appt.scheduledAt.getHours() * 60 + appt.scheduledAt.getMinutes()
    for (let m = apptStart; m < apptStart + appt.durationMin; m++) {
      bookedMinutes.add(m)
    }
  }

  for (const w of slotMaskWindows ?? []) {
    const [sh, sm] = w.startTime.split(':').map(Number)
    const [eh, em] = w.endTime.split(':').map(Number)
    const start = sh * 60 + (sm ?? 0)
    const end = eh * 60 + (em ?? 0)
    for (let m = start; m < end; m++) {
      bookedMinutes.add(m)
    }
  }

  for (const avail of availability) {
    const [startH, startM] = avail.startTime.split(':').map(Number)
    const [endH, endM] = avail.endTime.split(':').map(Number)
    let current = startH * 60 + (startM ?? 0)
    const end = endH * 60 + (endM ?? 0)

    while (current + avail.slotDurationMin <= end) {
      if (minStartMinutesFromMidnight != null && current < minStartMinutesFromMidnight) {
        current += avail.slotDurationMin
        continue
      }

      const slotFree = !Array.from({ length: avail.slotDurationMin }, (_, i) => current + i).some(
        (m) => bookedMinutes.has(m),
      )

      if (slotFree) {
        const h = Math.floor(current / 60)
        const m = current % 60
        const eh = Math.floor((current + avail.slotDurationMin) / 60)
        const em = (current + avail.slotDurationMin) % 60
        slots.push({
          time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
          endTime: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`,
        })
      }

      current += avail.slotDurationMin
    }
  }

  return slots.sort((a, b) => a.time.localeCompare(b.time))
}
