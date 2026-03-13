import type { PrismaClient } from '../../generated/prisma/client.js'

const TZ_BR = 'America/Sao_Paulo'

function parseDateRange(from?: string, to?: string): { start: Date; end: Date } {
  const now = new Date()
  const todayStr = now.toLocaleString('en-CA', { timeZone: TZ_BR }).slice(0, 10)
  const [y, m, d] = todayStr.split('-').map(Number)
  const startOfMonth = new Date(y, m - 1, 1, 0, 0, 0, 0)
  const endOfMonth = new Date(y, m, 0, 23, 59, 59, 999)

  const start = from ? new Date(from + 'T00:00:00.000Z') : startOfMonth
  const end = to ? new Date(to + 'T23:59:59.999Z') : endOfMonth
  return { start, end }
}

function toNumber(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'number' && !Number.isNaN(val)) return val
  if (typeof val === 'object' && val !== null && 'toNumber' in val) return (val as { toNumber: () => number }).toNumber()
  return Number(val) || 0
}

export interface StatsOverview {
  leadsTotal: number
  appointmentScheduledTotal: number
  appointmentsToday: number
  revenuePaid: number
  chargesOverdueCount: number
  chargesOverdueAmount: number
  escalationsCount: number
  noShowRate: number
}

export async function getStatsOverview(
  db: PrismaClient,
  tenantId: string,
  opts?: { from?: string; to?: string; professionalId?: string },
): Promise<StatsOverview> {
  const { start, end } = parseDateRange(opts?.from, opts?.to)
  const todayStart = new Date().toLocaleString('en-CA', { timeZone: TZ_BR }).slice(0, 10) + 'T00:00:00.000Z'
  const todayEnd = new Date().toLocaleString('en-CA', { timeZone: TZ_BR }).slice(0, 10) + 'T23:59:59.999Z'

  const baseWhere = { tenantId, ...(opts?.professionalId && { professionalId: opts.professionalId }) }
  const apptWhere = { ...baseWhere, scheduledAt: { gte: new Date(todayStart), lte: new Date(todayEnd) } }

  const [
    leadsTotal,
    appointmentScheduledTotal,
    appointmentsToday,
    revenueResult,
    chargesOverdue,
    escalationsCount,
    completedNoShow,
  ] = await Promise.all([
    db.contact.count({
      where: {
        tenantId,
        isActive: true,
        status: { in: ['NEW_LEAD', 'QUALIFIED'] },
      },
    }),
    db.contact.count({
      where: { tenantId, isActive: true, status: 'APPOINTMENT_SCHEDULED' },
    }),
    db.appointment.count({
      where: {
        ...apptWhere,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    }),
    db.charge.aggregate({
      where: {
        tenantId,
        status: 'PAID',
        paidAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    }),
    db.charge.aggregate({
      where: { tenantId, status: 'OVERDUE' },
      _count: true,
      _sum: { amount: true },
    }),
    db.agentJobLog.count({
      where: {
        tenantId,
        status: 'ESCALATED',
        createdAt: { gte: start, lte: end },
      },
    }),
    db.appointment.groupBy({
      by: ['status'],
      where: {
        tenantId,
        status: { in: ['COMPLETED', 'NO_SHOW'] },
        scheduledAt: { gte: start, lte: end },
      },
      _count: true,
    }),
  ])

  const completed = completedNoShow.find((r) => r.status === 'COMPLETED')?._count ?? 0
  const noShow = completedNoShow.find((r) => r.status === 'NO_SHOW')?._count ?? 0
  const totalOutcome = completed + noShow
  const noShowRate = totalOutcome > 0 ? (noShow / totalOutcome) * 100 : 0

  return {
    leadsTotal,
    appointmentScheduledTotal,
    appointmentsToday,
    revenuePaid: toNumber(revenueResult._sum.amount),
    chargesOverdueCount: chargesOverdue._count,
    chargesOverdueAmount: toNumber(chargesOverdue._sum.amount),
    escalationsCount,
    noShowRate: Math.round(noShowRate * 10) / 10,
  }
}

export interface StageCount {
  stageId: string
  stageName: string
  funnelName: string
  count: number
}

export interface StatsFunnel {
  byStage: StageCount[]
}

export async function getStatsFunnel(
  db: PrismaClient,
  tenantId: string,
  opts?: { funnelId?: string },
): Promise<StatsFunnel> {
  const stages = await db.stage.findMany({
    where: {
      tenantId,
      funnel: {
        isActive: true,
        ...(opts?.funnelId && { id: opts.funnelId }),
      },
    },
    include: {
      funnel: { select: { name: true } },
      _count: { select: { contacts: true } },
    },
    orderBy: [{ funnel: { order: 'asc' } }, { order: 'asc' }],
  })

  const byStage: StageCount[] = stages.map((s) => ({
    stageId: s.id,
    stageName: s.name,
    funnelName: s.funnel.name,
    count: s._count.contacts,
  }))

  return { byStage }
}

export interface DayAppointments {
  date: string
  total: number
  pending: number
  confirmed: number
  completed: number
  cancelled: number
  noShow: number
}

export interface StatsAgenda {
  byDay: DayAppointments[]
}

export async function getStatsAgenda(
  db: PrismaClient,
  tenantId: string,
  opts: { from: string; to: string; professionalId?: string },
): Promise<StatsAgenda> {
  const { start, end } = parseDateRange(opts.from, opts.to)
  const baseWhere = {
    tenantId,
    scheduledAt: { gte: start, lte: end },
    ...(opts.professionalId && { professionalId: opts.professionalId }),
  }

  const appointments = await db.appointment.findMany({
    where: baseWhere,
    select: { scheduledAt: true, status: true },
  })

  const byDate = new Map<string, Partial<Record<string, number>>>()
  for (const a of appointments) {
    const d = a.scheduledAt instanceof Date ? a.scheduledAt : new Date(a.scheduledAt)
    const dateStr = d.toLocaleString('en-CA', { timeZone: TZ_BR }).slice(0, 10)
    const prev = byDate.get(dateStr) ?? {}
    prev[a.status] = (prev[a.status] ?? 0) + 1
    byDate.set(dateStr, prev)
  }

  const byDay: DayAppointments[] = Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, statuses]) => ({
      date,
      total:
        (statuses.PENDING ?? 0) +
        (statuses.CONFIRMED ?? 0) +
        (statuses.COMPLETED ?? 0) +
        (statuses.CANCELLED ?? 0) +
        (statuses.NO_SHOW ?? 0),
      pending: statuses.PENDING ?? 0,
      confirmed: statuses.CONFIRMED ?? 0,
      completed: statuses.COMPLETED ?? 0,
      cancelled: statuses.CANCELLED ?? 0,
      noShow: statuses.NO_SHOW ?? 0,
    }))

  return { byDay }
}

export interface StatsRevenue {
  paid: number
  paidCount: number
  pending: number
  pendingCount: number
  overdue: number
  overdueCount: number
}

export async function getStatsRevenue(
  db: PrismaClient,
  tenantId: string,
  opts?: { from?: string; to?: string },
): Promise<StatsRevenue> {
  const { start, end } = parseDateRange(opts?.from, opts?.to)

  const [paid, pending, overdue] = await Promise.all([
    db.charge.aggregate({
      where: { tenantId, status: 'PAID', paidAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    }),
    db.charge.aggregate({
      where: { tenantId, status: 'PENDING' },
      _sum: { amount: true },
      _count: true,
    }),
    db.charge.aggregate({
      where: { tenantId, status: 'OVERDUE' },
      _sum: { amount: true },
      _count: true,
    }),
  ])

  return {
    paid: toNumber(paid._sum.amount),
    paidCount: paid._count,
    pending: toNumber(pending._sum.amount),
    pendingCount: pending._count,
    overdue: toNumber(overdue._sum.amount),
    overdueCount: overdue._count,
  }
}

export interface StatsAgent {
  messagesFromAgent: number
  escalations: number
  guardrailViolations: number
  guardrailBlocked: number
  resolutionRate: number
  totalInputTokens: number
  totalOutputTokens: number
}

export async function getStatsAgent(
  db: PrismaClient,
  tenantId: string,
  opts?: { from?: string; to?: string },
): Promise<StatsAgent> {
  const { start, end } = parseDateRange(opts?.from, opts?.to)

  const [
    messagesFromAgent,
    jobLogs,
    guardrailStats,
  ] = await Promise.all([
    db.message.count({
      where: {
        tenantId,
        role: 'AGENT',
        createdAt: { gte: start, lte: end },
      },
    }),
    db.agentJobLog.groupBy({
      by: ['status'],
      where: {
        tenantId,
        createdAt: { gte: start, lte: end },
      },
      _count: true,
      _sum: { totalInputTokens: true, totalOutputTokens: true },
    }),
    db.guardrailViolation.groupBy({
      by: ['wasBlocked'],
      where: {
        tenantId,
        createdAt: { gte: start, lte: end },
      },
      _count: true,
    }),
  ])

  const replied = jobLogs.find((r) => r.status === 'REPLIED')?._count ?? 0
  const triggerResolved = jobLogs.find((r) => r.status === 'TRIGGER_RESOLVED')?._count ?? 0
  const escalated = jobLogs.find((r) => r.status === 'ESCALATED')?._count ?? 0
  const error = jobLogs.find((r) => r.status === 'ERROR')?._count ?? 0
  const resolved = replied + triggerResolved
  const total = resolved + escalated + error
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 1000) / 10 : 100

  let totalInputTokens = 0
  let totalOutputTokens = 0
  for (const j of jobLogs) {
    totalInputTokens += toNumber(j._sum.totalInputTokens)
    totalOutputTokens += toNumber(j._sum.totalOutputTokens)
  }

  const guardrailViolations = guardrailStats.reduce((acc, g) => acc + g._count, 0)
  const guardrailBlocked = guardrailStats.find((g) => g.wasBlocked)?._count ?? 0

  return {
    messagesFromAgent,
    escalations: escalated,
    guardrailViolations,
    guardrailBlocked,
    resolutionRate,
    totalInputTokens,
    totalOutputTokens,
  }
}
