import type { PrismaClient } from '../generated/prisma/client.js'

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

export interface SearchAvailabilityResult {
  date: string
  dateFormatted: string
  professionals: AvailabilityProfessional[]
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
      availabilityExceptions: {
        where: { date: dateStart, isUnavailable: true },
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
    if (prof.availabilityExceptions.length > 0) continue
    if (prof.availability.length === 0) continue

    const services = prof.professionalServices.map((ps) => ({
      id: ps.service.id,
      name: ps.service.name,
      durationMin: ps.service.durationMin,
      price: Number(ps.service.price),
    }))

    if (services.length === 0) continue

    const slots = buildTimeSlotsForDate(
      prof.availability,
      prof.appointments,
      minStart,
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

  return {
    date: dateStr,
    dateFormatted,
    professionals,
  }
}

function buildTimeSlotsForDate(
  availability: { startTime: string; endTime: string; slotDurationMin: number }[],
  existingAppointments: { scheduledAt: Date; durationMin: number }[],
  minStartMinutesFromMidnight?: number,
): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = []
  const bookedMinutes = new Set<number>()

  for (const appt of existingAppointments) {
    const apptStart = appt.scheduledAt.getHours() * 60 + appt.scheduledAt.getMinutes()
    for (let m = apptStart; m < apptStart + appt.durationMin; m++) {
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
