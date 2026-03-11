/**
 * Remove duplicatas de overrides, exceptions e block ranges.
 * Mantém um registro por grupo, deleta o restante.
 *
 * Run: pnpm exec tsx --env-file=.env.production.local scripts/dedupe-availability.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

try {
  const envPath = resolve(process.cwd(), '.env.production.local')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    value = value.replace(/\s+#.*$/, '')
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  try {
    const envPath = resolve(process.cwd(), '.env')
    const lines = readFileSync(envPath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      value = value.replace(/\s+#.*$/, '')
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // rely on existing env
  }
}

import { PrismaClient } from '../src/generated/prisma/client.js'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL']! })
const adapter = new PrismaPg(pool)
const db = new PrismaClient({ adapter })

function toIsoDate(d: Date): string {
  return (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10)
}

function normalizeSlotMask(slotMask: unknown): string {
  if (!slotMask || !Array.isArray(slotMask)) return ''
  const arr = slotMask as Array<{ startTime?: string; endTime?: string }>
  const sorted = [...arr]
    .filter((w) => w && typeof w.startTime === 'string' && typeof w.endTime === 'string')
    .sort(
      (a, b) =>
        (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
        (a.endTime ?? '').localeCompare(b.endTime ?? ''),
    )
  return JSON.stringify(sorted)
}

async function main() {
  console.log('🧹 Deduplicando overrides, exceptions e block ranges…\n')

  let totalDeleted = 0

  // ─── Overrides ─────────────────────────────────────────────────────────────
  const overrides = await db.availabilityOverride.findMany({ orderBy: { id: 'asc' } })
  const overrideGroups = new Map<string, string[]>()
  for (const o of overrides) {
    const key = `${o.professionalId}|${toIsoDate(o.date)}|${o.startTime}|${o.endTime}`
    const ids = overrideGroups.get(key) ?? []
    ids.push(o.id)
    overrideGroups.set(key, ids)
  }

  for (const [key, ids] of overrideGroups) {
    if (ids.length > 1) {
      const toDelete = ids.slice(1)
      await db.availabilityOverride.deleteMany({ where: { id: { in: toDelete } } })
      totalDeleted += toDelete.length
      console.log(`  Override: ${key} → removidas ${toDelete.length} duplicatas`)
    }
  }

  // ─── Exceptions ────────────────────────────────────────────────────────────
  const exceptions = await db.availabilityException.findMany({ orderBy: { id: 'asc' } })
  const exceptionGroups = new Map<string, string[]>()
  for (const e of exceptions) {
    const slotNorm = normalizeSlotMask(e.slotMask)
    const key = `${e.professionalId}|${toIsoDate(e.date)}|${e.isUnavailable}|${slotNorm}`
    const ids = exceptionGroups.get(key) ?? []
    ids.push(e.id)
    exceptionGroups.set(key, ids)
  }

  for (const [key, ids] of exceptionGroups) {
    if (ids.length > 1) {
      const toDelete = ids.slice(1)
      await db.availabilityException.deleteMany({ where: { id: { in: toDelete } } })
      totalDeleted += toDelete.length
      console.log(`  Exception: ${key} → removidas ${toDelete.length} duplicatas`)
    }
  }

  // ─── Block ranges ──────────────────────────────────────────────────────────
  const blockRanges = await db.availabilityBlockRange.findMany({ orderBy: { id: 'asc' } })
  const blockGroups = new Map<string, string[]>()
  for (const b of blockRanges) {
    const key = `${b.professionalId}|${toIsoDate(b.dateFrom)}|${toIsoDate(b.dateTo)}`
    const ids = blockGroups.get(key) ?? []
    ids.push(b.id)
    blockGroups.set(key, ids)
  }

  for (const [key, ids] of blockGroups) {
    if (ids.length > 1) {
      const toDelete = ids.slice(1)
      await db.availabilityBlockRange.deleteMany({ where: { id: { in: toDelete } } })
      totalDeleted += toDelete.length
      console.log(`  Block range: ${key} → removidas ${toDelete.length} duplicatas`)
    }
  }

  console.log(`\n✅ Total removido: ${totalDeleted} duplicatas`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => pool.end())
