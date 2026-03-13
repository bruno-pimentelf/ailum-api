import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_URL: z.string().url(),
  APP_URL: z.string().min(1),
  ALLOWED_ORIGINS: z.string().optional().default(''),
  COOKIE_DOMAIN: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'gemini']).optional().default('anthropic'),
  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(''),
  ASAAS_WEBHOOK_TOKEN: z.string().optional().default(''),
  ASAAS_USE_SANDBOX: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  ZAPI_WEBHOOK_TOKEN: z.string().optional().default(''),
  ELEVENLABS_API_KEY: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
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
  const msg = `Invalid environment variables:\n${errors}`
  console.error(`[env] ${msg}`)
  throw new Error(msg)
}

export const env = parsed.data
export type Env = typeof env
