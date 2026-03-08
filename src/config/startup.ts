import type { PrismaClient } from '../generated/prisma/client.js'
import type { Redis } from 'ioredis'
import type { Firestore } from 'firebase-admin/firestore'

interface StartupDeps {
  db: PrismaClient
  redis: Redis
  firestore: Firestore | null
}

export async function validateStartup(deps: StartupDeps): Promise<void> {
  const fatal: string[] = []
  const warnings: string[] = []

  try {
    await deps.db.$queryRaw`SELECT 1`
  } catch (err) {
    fatal.push(`PostgreSQL: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    const pong = await deps.redis.ping()
    if (pong !== 'PONG') {
      warnings.push('Redis: unexpected response to PING')
    }
  } catch (err) {
    warnings.push(`Redis: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (deps.firestore) {
    try {
      await deps.firestore.listCollections()
    } catch (err) {
      warnings.push(`Firebase Firestore: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    warnings.push('Firebase Firestore: not configured (FIREBASE_PROJECT_ID missing)')
  }

  if (warnings.length > 0) {
    console.warn(`⚠ Startup warnings:\n${warnings.map((w) => `  • ${w}`).join('\n')}`)
  }

  if (fatal.length > 0) {
    throw new Error(
      `Startup validation failed — critical dependencies unavailable:\n${fatal
        .map((e) => `  • ${e}`)
        .join('\n')}`,
    )
  }
}
