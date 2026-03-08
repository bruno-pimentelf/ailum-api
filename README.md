# Ailum Backend

Multi-tenant B2B SaaS backend for medical clinic automation via WhatsApp. Built with Fastify, Prisma 7, PostgreSQL, Redis, Firebase Firestore, and Claude AI.

---

## Requirements

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| pnpm | 10+ |
| Docker + Docker Compose | Latest |
| PostgreSQL | 15+ (via Docker) |
| Redis | 7+ (via Docker) |

---

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd ailum-back
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env — see "Environment Variables" section below

# 3. Start infrastructure
docker-compose up -d

# 4. Run migrations
pnpm db:migrate

# 5. (Optional) Seed example data
pnpm db:seed

# 6. Start development server
pnpm dev
```

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/ailum` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `BETTER_AUTH_SECRET` | Secret key for Better Auth (min 32 chars) | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public URL of this backend | `http://localhost:3001` |
| `WEB_URL` | Frontend web app URL (CORS) | `http://localhost:3000` |
| `APP_URL` | Mobile app URL or scheme (CORS) | `exp://localhost:8081` |
| `ANTHROPIC_API_KEY` | Claude API key | `sk-ant-...` |
| `FIREBASE_PROJECT_ID` | Firebase project ID | `ailum-prod` |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | `firebase-adminsdk@...iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key (with `\n`) | `"-----BEGIN RSA PRIVATE KEY-----\n..."` |
| `ASAAS_WEBHOOK_TOKEN` | Token to validate Asaas webhooks | `whsec_...` |
| `ZAPI_WEBHOOK_TOKEN` | Token to validate Z-API webhooks | `token_...` |
| `ELEVENLABS_API_KEY` | ElevenLabs API key (optional) | `el_...` |
| `RESEND_API_KEY` | Resend email API key | `re_...` |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting tenant API keys | `openssl rand -hex 32` |
| `PORT` | HTTP port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `LOG_LEVEL` | Pino log level | `info` |

---

## Architecture

```
src/
├── config/
│   ├── env.ts              # Zod env validation — single source of truth
│   ├── encryption.ts       # AES-256-GCM encrypt/decrypt for tenant API keys
│   └── startup.ts          # Pre-flight checks (Postgres, Redis, Firebase)
│
├── plugins/                # Fastify plugins (fp-wrapped, decorated on instance)
│   ├── db.ts               # PrismaClient with @prisma/adapter-pg
│   ├── redis.ts            # ioredis with auto-reconnect
│   ├── firebase.ts         # Firebase Admin SDK + Firestore
│   ├── auth.ts             # Better Auth (JWT, org/member mirrors, decorators)
│   └── sensible.ts         # @fastify/sensible (httpErrors helpers)
│
├── modules/                # Business domain modules (routes + service + schema)
│   ├── contacts/           # Contact management + funnel stage moves
│   ├── scheduling/         # Appointments + slot availability
│   ├── billing/            # PIX charges via Asaas
│   ├── funnels/            # Funnels, stages, agent configs, triggers
│   ├── professionals/      # Professionals + availability + exceptions
│   ├── services/           # Clinic services (procedures)
│   ├── members/            # Tenant members + invitations
│   ├── voices/             # TTS voices configuration
│   ├── agent/              # AI agent orchestrator (router, stage agent, tools, memory)
│   └── webhooks/           # Z-API (WhatsApp) + Asaas (payments) webhooks
│
├── services/               # Shared external service wrappers
│   ├── asaas.service.ts    # Asaas REST API (PIX charges, customers)
│   ├── zapi.service.ts     # Z-API REST (WhatsApp messaging)
│   ├── firebase-sync.ts    # Postgres → Firestore sync helpers
│   ├── email.service.ts    # Resend transactional email
│   └── voice.service.ts    # ElevenLabs/Azure/OpenAI TTS
│
├── jobs/                   # BullMQ background workers
│   ├── queues.ts           # Queue definitions + default options
│   ├── agent.job.ts        # Processes incoming WhatsApp messages through AI
│   ├── trigger-engine.job.ts # Evaluates stage triggers every 60s
│   ├── reminder.job.ts     # Appointment reminders (24h + 1h before)
│   ├── pix-expire.job.ts   # Marks expired PIX charges as OVERDUE
│   └── memory-consolidation.job.ts # Extracts facts from conversations
│
├── constants/
│   ├── permissions.ts      # ROLE_PERMISSIONS map (ADMIN/PROFESSIONAL/SECRETARY)
│   ├── status-transitions.ts # tool/event → ContactStatus transitions
│   └── agent-tools.ts      # TypeBox schemas for all 5 agent tools
│
├── types/
│   ├── fastify.d.ts        # Fastify interface augmentations (decorators)
│   └── context.ts          # AgentContext, RequestContext, JobContext types
│
├── app.ts                  # buildApp() — assembles all plugins and routes
└── server.ts               # Entry point — startup validation, workers, HTTP listen
```

### Multi-tenancy

Every database table includes a `tenantId` column. All queries in service functions are scoped with `WHERE tenantId = req.tenantId`. The `tenantId` is resolved by the `authenticate` decorator via the active Better Auth organization session.

### AI Agent Pipeline

```
WhatsApp message
  → Z-API Webhook → agentQueue (BullMQ)
  → orchestrate()
      ├─ buildContext()      ← parallel DB queries
      ├─ routeMessage()      ← Claude Haiku (intent classification)
      ├─ runStageAgent()     ← Claude Sonnet (tool-use loop, max 5 iterations)
      │   └─ executeToolSafely() for each tool_use block
      ├─ applyGuardrails()   ← Claude Haiku (safety check)
      ├─ syncFirestore()     ← Firestore realtime update
      └─ consolidateMemories() ← async, Claude Haiku (fact extraction)
  → Z-API send reply
```

---

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/sign-in/email` | Login |
| `POST` | `/auth/sign-up/email` | Register |
| `POST` | `/auth/sign-out` | Logout |
| `GET` | `/auth/session` | Current session |
| `POST` | `/auth/organization/create` | Create organization (tenant) |
| `POST` | `/auth/organization/invite-member` | Invite team member |

### Contacts — `/v1/contacts`
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List with filters (funnelId, stageId, status, search) |
| `GET` | `/:id` | Details + appointments + charges + messages |
| `POST` | `/` | Create contact |
| `PATCH` | `/:id` | Update name/email/notes/professional |
| `PATCH` | `/:id/stage` | Move to another stage |
| `DELETE` | `/:id` | Soft delete |

### Scheduling — `/v1/appointments`
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List appointments |
| `GET` | `/:id` | Details |
| `POST` | `/` | Create (conflict check) |
| `PATCH` | `/:id` | Update status/notes |
| `DELETE` | `/:id` | Cancel |
| `GET` | `/professionals/:id/availability` | Available slots for a date |

### Billing — `/v1/charges`
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List charges |
| `GET` | `/:id` | Details |
| `POST` | `/` | Create PIX charge via Asaas |
| `POST` | `/:id/cancel` | Cancel charge |

### Funnels — `/v1/funnels`
Includes CRUD for funnels, stages, stage agent configs, and triggers. Triggers support `PATCH /:id/toggle` for quick enable/disable.

### Professionals — `/v1/professionals`
Includes CRUD, weekly availability management (`PUT /:id/availability`), date exceptions, and service associations.

### Webhooks
| Method | Path | Auth |
|--------|------|------|
| `POST` | `/webhooks/zapi` | Header `client-token` |
| `POST` | `/webhooks/asaas` | Header `asaas-access-token` |

### Agent
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/agent/message` | Queue message for AI processing (202) |
| `POST` | `/v1/agent/confirm` | Confirm pending tool actions |
| `GET` | `/v1/agent/job/:jobId` | Get job status |

---

## Available Scripts

```bash
pnpm dev          # Development server with hot reload (tsx watch)
pnpm build        # TypeScript compile to dist/
pnpm start        # Run compiled server
pnpm db:migrate   # Run Prisma migrations
pnpm db:studio    # Open Prisma Studio
pnpm db:generate  # Regenerate Prisma client
pnpm db:seed      # Seed example data
```
