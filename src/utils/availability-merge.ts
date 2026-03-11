/**
 * Junta grade semanal + overrides do dia em janelas de horário únicas (merge de sobreposições).
 * Quando um dia tem tanto slots semanais quanto overrides, usa os dois — alinhado com o frontend.
 */
export interface AvailabilityWindow {
  startTime: string
  endTime: string
  slotDurationMin: number
}

export function mergeAvailabilityForDay(
  weekly: AvailabilityWindow[],
  overrides: AvailabilityWindow[],
): AvailabilityWindow[] {
  const all: { start: number; end: number; slotDurationMin: number }[] = [
    ...weekly.map((w) => toMinutes(w)),
    ...overrides.map((w) => toMinutes(w)),
  ].filter((x) => x.start < x.end)

  if (all.length === 0) return []

  all.sort((a, b) => a.start - b.start)

  const merged: { start: number; end: number; slotDurationMin: number }[] = []
  let current = all[0]!

  for (let i = 1; i < all.length; i++) {
    const next = all[i]!
    if (next.start <= current.end) {
      current = {
        start: current.start,
        end: Math.max(current.end, next.end),
        slotDurationMin: Math.min(current.slotDurationMin, next.slotDurationMin),
      }
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)

  return merged.map((m) => ({
    startTime: fromMinutes(m.start),
    endTime: fromMinutes(m.end),
    slotDurationMin: m.slotDurationMin,
  }))
}

function toMinutes(w: AvailabilityWindow): { start: number; end: number; slotDurationMin: number } {
  const [sh, sm] = w.startTime.split(':').map(Number)
  const [eh, em] = w.endTime.split(':').map(Number)
  return {
    start: sh * 60 + (sm ?? 0),
    end: eh * 60 + (em ?? 0),
    slotDurationMin: w.slotDurationMin ?? 50,
  }
}

function fromMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
