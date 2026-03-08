import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_URL: z.string().url(),
  APP_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_CLIENT_EMAIL: z.string().email(),
  FIREBASE_PRIVATE_KEY: z.string().min(1),
  ASAAS_WEBHOOK_TOKEN: z.string().min(1),
  ZAPI_WEBHOOK_TOKEN: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().optional().default(''),
  RESEND_API_KEY: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)'),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const errors = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  throw new Error(`Invalid environment variables:\n${errors}`)
}

export const env = parsed.data
export type Env = typeof env
