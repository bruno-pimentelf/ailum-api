# CONTEXT — clinic-ai-api

Documento de contexto completo do projeto. Leia antes de qualquer resposta.

---

## O que é o produto

SaaS B2B multi-tenant de automação de atendimento via WhatsApp para clínicas médicas brasileiras. Cada clínica é um tenant isolado. Um agente de IA atende os pacientes/leads, agenda consultas, gera cobranças PIX e move contatos entre estágios de funis de venda — tudo via WhatsApp.

---

## Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20+ |
| Framework HTTP | Fastify v5 com TypeScript |
| Validação | TypeBox (type provider nativo Fastify v5) |
| ORM | Prisma |
| Banco principal | PostgreSQL 16 (fonte da verdade de negócio) |
| Realtime | Firebase Firestore (estado do painel — backend só escreve, nunca lê) |
| Filas | BullMQ + ioredis (Redis 7) |
| Auth | Better Auth com plugin organization |
| IA | Anthropic SDK — claude-haiku-4-5 e claude-sonnet-4-6 |
| WhatsApp | ZAPI (webhooks + envio) |
| Pagamentos | Asaas (PIX dinâmico + webhooks) |
| Voz | ElevenLabs (clonagem e TTS) |
| Email | Resend |
| Logs | Pino + pino-pretty |

---

## Estrutura de pastas

```
src/
  server.ts                  entry point — listen + graceful shutdown
  app.ts                     buildApp() — registra plugins e rotas
  config/
    env.ts                   valida todas env vars com Zod, exporta objeto env tipado
    encryption.ts            AES-256-GCM — encrypt/decrypt para API keys no banco
  plugins/
    db.ts                    Prisma como plugin fp() — fastify.db
    redis.ts                 ioredis como plugin fp() — fastify.redis
    firebase.ts              Firebase Admin como plugin fp() — fastify.firebase.{admin,firestore}
    auth.ts                  Better Auth — decorators fastify.authenticate e fastify.authorize(permission)
    sensible.ts              fastify-sensible — fastify.httpErrors
  modules/
    contacts/                CRUD de contatos + mover entre stages
    scheduling/              CRUD de agendamentos + disponibilidade de profissionais
    billing/                 CRUD de cobranças PIX
    funnels/                 CRUD de funis, stages, stage_agent_configs, triggers
    professionals/           CRUD de profissionais + disponibilidade + exceções
    services/                CRUD de serviços oferecidos pela clínica
    members/                 CRUD de membros + convites por email
    agent/
      orchestrator.ts        função principal orchestrate() — coordena todos os níveis
      context-builder.ts     buildContext() — monta estado completo, zero tokens
      router.agent.ts        routeMessage() — Haiku, classifica intent
      stage.agent.ts         runStageAgent() — Sonnet, subagente especializado
      tool-executor.ts       executeToolSafely() — executa tools, aplica transições
      guardrail.agent.ts     applyGuardrails() — Haiku, verifica resposta
      memory.service.ts      consolidateMemories() — extrai entidades assincronamente
      agent.routes.ts        POST /v1/agent/message, POST /v1/agent/confirm, GET /v1/agent/job/:id
    webhooks/
      zapi.webhook.ts        POST /webhooks/zapi — recebe mensagens do WhatsApp
      asaas.webhook.ts       POST /webhooks/asaas — confirma pagamentos PIX
  jobs/
    queues.ts                exporta todas as filas BullMQ
    agent.job.ts             worker — chama orchestrate()
    trigger-engine.job.ts    cron 60s — avalia e dispara triggers
    reminder.job.ts          cron 30min — lembretes de agendamento
    pix-expire.job.ts        cron 5min — marca PIX vencidos
    memory-consolidation.job.ts  worker assíncrono — consolida memórias
  services/
    firebase-sync.service.ts espelha Postgres → Firestore após cada mutação
    asaas.service.ts         wrapper REST da API Asaas
    zapi.service.ts          wrapper REST da ZAPI
    voice.service.ts         wrapper ElevenLabs TTS
    email.service.ts         Resend para convites e notificações
  constants/
    permissions.ts           ROLE_PERMISSIONS: Record<MemberRole, string[]>
    status-transitions.ts    STATUS_TRANSITIONS: Record<toolName, ContactStatus>
    agent-tools.ts           definições TypeBox das tools do agente
  types/
    fastify.d.ts             declare module 'fastify' — todos os decorators e request props
    context.ts               interface Context completa
```

---

## Schema do banco (Prisma / PostgreSQL)

### Enums

```
MemberRole:        ADMIN | PROFESSIONAL | SECRETARY
ContactStatus:     NEW_LEAD | QUALIFIED | APPOINTMENT_SCHEDULED | AWAITING_PAYMENT |
                   PAYMENT_CONFIRMED | ATTENDED | NO_INTEREST | RECURRING | IN_HUMAN_SERVICE
AppointmentStatus: PENDING | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW
ChargeStatus:      PENDING | PAID | OVERDUE | CANCELLED | REFUNDED
TriggerEvent:      STAGE_ENTERED | STALE_IN_STAGE | PAYMENT_CONFIRMED |
                   APPOINTMENT_APPROACHING | AI_INTENT | MESSAGE_RECEIVED
TriggerAction:     SEND_MESSAGE | MOVE_STAGE | GENERATE_PIX | NOTIFY_OPERATOR | WAIT_AND_REPEAT
MessageRole:       CONTACT | AGENT | OPERATOR | SYSTEM
MessageType:       TEXT | IMAGE | AUDIO | DOCUMENT | PIX_CHARGE
VoiceProvider:     ELEVENLABS | AZURE | OPENAI
AgentModel:        HAIKU | SONNET
```

### Tabelas principais

**Better Auth (geradas automaticamente):** user, session, account, verification, organization, member, invitation

**tenants** — espelho da organization do Better Auth com configs extras
- id, clerk_org_id (unique — ID da org no Better Auth), name, slug (unique), plan
- agent_base_prompt (prompt base da clínica para o agente)
- guardrail_rules (regras específicas da clínica para o guardrail)
- max_pix_amount decimal(10,2), is_active, created_at

**tenant_integrations** — credenciais criptografadas por provider
- id, tenant_id, provider ('zapi'|'asaas'|'elevenlabs')
- instance_id, api_key_encrypted, webhook_token, is_active
- unique: (tenant_id, provider)

**tenant_members** — espelho do member do Better Auth com dados extras
- id, tenant_id, user_id (Better Auth user id), role (MemberRole)
- professional_id (nullable — se membro é profissional), is_active, joined_at

**professionals**
- id, tenant_id, user_id (nullable — se tem acesso ao sistema)
- full_name, specialty, bio, avatar_url, voice_id (fk nullable)
- calendar_color, is_active

**professional_availability** — disponibilidade recorrente
- id, professional_id, day_of_week (0-6), start_time, end_time, slot_duration_min (default 50)

**availability_exceptions** — folgas e bloqueios pontuais
- id, professional_id, date (DATE), is_unavailable (bool), reason

**services**
- id, tenant_id, name, description, duration_min (default 50), price decimal(10,2), is_active

**professional_services** — M2M profissional ↔ serviço
- professional_id, service_id, custom_price (nullable — sobrescreve preço do serviço)
- PK composta: (professional_id, service_id)

**voices**
- id, tenant_id, name, provider (VoiceProvider), provider_voice_id
- sample_url, is_default (bool), created_at

**funnels**
- id, tenant_id, name, description, is_active, order

**stages**
- id, funnel_id, tenant_id, name, color, order, is_terminal (bool)

**stage_agent_configs** — configuração do subagente por stage (1:1 com stage)
- id, stage_id (unique), funnel_agent_name, funnel_agent_personality
- stage_context, allowed_tools (string[]), model (AgentModel), temperature (float)

**triggers**
- id, stage_id, tenant_id, event (TriggerEvent), action (TriggerAction)
- action_config (json), condition_config (json nullable)
- delay_minutes (int), cooldown_seconds (int default 3600), is_active

**contacts**
- id, tenant_id, phone, name, email, notes
- current_funnel_id (fk nullable), current_stage_id (fk nullable)
- status (ContactStatus default NEW_LEAD), stage_entered_at, last_message_at
- last_detected_intent, last_payment_status
- assigned_professional_id (fk nullable), zapi_session_id
- metadata (json nullable), is_active, created_at, updated_at
- unique: (tenant_id, phone)

**appointments**
- id, tenant_id, contact_id, professional_id, service_id
- scheduled_at (timestamptz), duration_min, status (AppointmentStatus)
- notes, charge_id (fk nullable unique), cancelled_reason
- created_by (string — 'agent'|'operator'|member_id)

**charges**
- id, tenant_id, contact_id, appointment_id (nullable unique)
- asaas_payment_id (text unique nullable), amount decimal(10,2), description
- status (ChargeStatus), pix_copy_paste, qr_code_base64
- due_at, paid_at, created_at, updated_at

**messages** — audit log (fonte realtime é Firestore)
- id, tenant_id, contact_id, role (MessageRole), type (MessageType)
- content, metadata (json nullable), zapi_message_id (unique nullable)
- session_id, created_at

**agent_memories** — entidades persistentes por contato
- id, tenant_id, contact_id, key (string), value (string), confidence (float)
- source_message_id (nullable), created_at, updated_at
- unique: (contact_id, key)

**trigger_executions** — audit de triggers disparados
- id, trigger_id, contact_id, tenant_id, executed_at, result (json)
- ai_generated, ai_prompt, ai_output

**guardrail_violations** — log de violações bloqueadas
- id, tenant_id, contact_id, original_response, violation, severity, was_blocked

**agent_job_logs** — métricas por execução do agente
- id, tenant_id, contact_id, message_id, router_intent, router_confidence
- stage_agent_tool_calls, total_input_tokens, total_output_tokens, duration_ms, error

---

## Arquitetura do agente (Hierarchical Agent Architecture)

### Fluxo completo

```
Mensagem chega (webhook ZAPI)
        ↓
    agentQueue (BullMQ) — nunca processa inline
        ↓
    orchestrate(message, contactId, tenantId)
        ↓
NÍVEL 0 — buildContext()         zero tokens — queries paralelas no banco
        ↓
NÍVEL 1 — routeMessage()         Haiku ~300 tokens — classifica intent
        ↓
    shouldEscalate?  → notify_operator → fim
    trigger resolve? → executa trigger (código puro) → fim
        ↓
NÍVEL 2 — runStageAgent()        Sonnet ~1200 tokens — subagente do funil
        ↓
    tool loop (máx 5 iterações)
        ↓
NÍVEL 3 — executeToolSafely()    código puro — executa tools, aplica STATUS_TRANSITIONS
        ↓
    requiresConfirmation?  → salva Redis TTL 600s → retorna para confirmação
        ↓
NÍVEL 4 — applyGuardrails()      Haiku ~350 tokens — verifica antes de entregar
        ↓
    salva audit (messages) + sincroniza Firestore
    consolidateMemories() assíncrono — sem await
        ↓
    resposta entregue via ZAPI
```

### Router Agent — intents possíveis
WANTS_SCHEDULE, WANTS_PRICE, WANTS_INFO, WANTS_CANCEL, CONFIRMING, OBJECTION, CRISIS, GENERAL_QUESTION, GREETING, NO_INTEREST, IS_PATIENT, WANTS_RESCHEDULE

Regras: confidence < 0.70 → shouldEscalate. intent === CRISIS → shouldEscalate sempre.

### Stage Agent — system prompt em camadas
- Camada 1 (cache): identidade base imutável + guardrails hardcoded
- Camada 2 (cache): agent_base_prompt do tenant
- Camada 3 (cache): funnel agent personality + objetivo do funil
- Camada 4 (cache): stage_context do stage atual
- Camada 5 (dinâmico): profissionais disponíveis hoje com horários
- Camada 6 (dinâmico): memórias do contato
- Camada 7 (dinâmico): tools permitidas neste stage

Camadas 1-4 usam cache_control: { type: 'ephemeral' } para prompt caching.
Apenas tools cujos nomes estão em stage_agent_config.allowed_tools são passadas ao modelo.

### Tools do agente
- create_appointment — verifica conflito antes, requiresConfirmation: true
- generate_pix — verifica PIX pendente existente antes (idempotência), requiresConfirmation: true
- move_stage — busca stage por nome no funil atual, requiresConfirmation: false
- notify_operator — envia para admin/secretary via ZAPI, requiresConfirmation: false
- send_message — envia via ZAPI, salva audit, requiresConfirmation: false

### STATUS_TRANSITIONS (determinístico, sem LLM)
```
'create_appointment'        → APPOINTMENT_SCHEDULED
'generate_pix'              → AWAITING_PAYMENT
'payment_confirmed_webhook' → PAYMENT_CONFIRMED
'notify_operator'           → IN_HUMAN_SERVICE
'move_stage:Qualificado'    → QUALIFIED
'move_stage:SemInteresse'   → NO_INTEREST
'move_stage:Recorrente'     → RECURRING
```
Mudança de status nunca chama o LLM — é consequência determinística da tool executada.

### Guardrail severidades
- LOW: substitui por mensagem genérica
- MEDIUM: escalona para humano
- HIGH: bloqueia + registra + alerta admin

### Memory consolidation
Haiku extrai entidades das mensagens após cada conversa e faz upsert em agent_memories.
Exemplos de keys: preferred_time, main_complaint, insurance, cancelled_once, price_sensitive, preferred_professional.

---

## Sistema de autenticação

Better Auth com plugin organization.
Após criação de organization → webhook interno cria registro espelho em tenants.
Após adição de member → cria registro em tenant_members.

### JWT payload (populado pelo decorator fastify.authenticate)
```typescript
req.userId         // Better Auth user id
req.tenantId       // ID da clínica ativa (organization id)
req.role           // MemberRole do usuário nesta clínica
req.memberId       // ID do tenant_member
req.professionalId // ID do profissional (nullable — só se membro é profissional)
req.member         // objeto TenantMember completo
```

NUNCA usar tenantId do body da requisição — sempre de req.tenantId (extraído do JWT).

### Roles e permissões

```typescript
// ROLE_PERMISSIONS em src/constants/permissions.ts
admin:        acesso total a todos os recursos
professional: contacts:read, billing:read, scheduling:read (agenda própria), services:read
secretary:    contacts:read/write, billing:read/write, scheduling:read/write, sem agent:configure
```

Uso nas rotas:
```typescript
onRequest: [fastify.authenticate, fastify.authorize('contacts:write')]
```

---

## Firebase Firestore — estrutura de coleções

Backend APENAS escreve. Frontend APENAS lê via onSnapshot.

```
tenants/{tenantId}/
  contacts/{contactId}
    → name, phone, status, funnelId, funnelName, stageName, stageColor,
      agentTyping (bool), lastMessageAt, updatedAt

  conversations/{contactId}
    → lastMessage, lastMessageAt, unreadCount, contactName, contactPhone, status, updatedAt
    
    messages/{messageId}
      → content, role, type, status, metadata, createdAt

  appointments/{appointmentId}
    → contactId, contactName, professionalName, serviceName,
      scheduledAt, status, chargeId, updatedAt

  charges/{chargeId}
    → contactId, amount, status, pixCopyPaste, expiresAt, paidAt, updatedAt
```

Regras: merge: true em todos os set(). FieldValue.serverTimestamp() para updatedAt.
Erros no Firestore são logados mas nunca propagados — não quebram o fluxo do Postgres.

---

## Webhooks

### ZAPI (POST /webhooks/zapi)
- Sem autenticação JWT. Valida header 'client-token' contra env.ZAPI_WEBHOOK_TOKEN.
- Retorna 200 sempre — ZAPI re-tenta em 5xx.
- Idempotência: verifica zapi_message_id em messages antes de processar.
- Fluxo: valida → busca tenant pelo instanceId → upsert contato → batch write Firestore → salva audit → enqueue agentQueue.

### Asaas (POST /webhooks/asaas)
- Sem autenticação JWT. Valida header 'asaas-access-token' contra env.ASAAS_WEBHOOK_TOKEN.
- Retorna 200 sempre.
- PAYMENT_RECEIVED: atualiza charge → atualiza contato → atualiza appointment → sincroniza Firestore → envia confirmação via ZAPI.
- PAYMENT_OVERDUE: atualiza charge → sincroniza Firestore → enqueue job de cobrança.

---

## Jobs BullMQ

| Job | Tipo | Frequência |
|---|---|---|
| agent.job | worker | sob demanda (webhook enfileira) |
| trigger-engine.job | cron | a cada 60s |
| reminder.job | cron | a cada 30min |
| pix-expire.job | cron | a cada 5min |
| memory-consolidation.job | worker | sob demanda (orchestrator enfileira) |

Configuração padrão: attempts 3, backoff exponential 2000ms, removeOnComplete 100, removeOnFail 500.

Idempotência do trigger engine via Redis:
- key: `trigger_fired:{triggerId}:{contactId}`
- TTL: trigger.cooldown_seconds (default 3600)

---

## Serviços externos

### Asaas
- Sandbox: https://sandbox.asaas.com/api/v3
- Header: `access_token: {apiKey}` — CHAVE DO CLIENTE, não global
- Funções: createPixCharge, getPaymentStatus, cancelPayment, createCustomer
- API key armazenada criptografada em tenant_integrations.api_key_encrypted

### ZAPI
- Funções: sendText, sendImage, sendAudio, sendDocument
- Credenciais: instanceId + clientToken do tenant (tenant_integrations)
- Função auxiliar getZapiConfig(tenantId, db) busca e decripta credenciais

### ElevenLabs
- Clonagem de voz: provider_voice_id salvo em voices
- Profissional tem voice_id (fk nullable para voices)
- Se não tem: usa voz padrão da clínica (voices.is_default = true)

---

## Variáveis de ambiente

```
DATABASE_URL                PostgreSQL connection string
REDIS_URL                   Redis connection string
BETTER_AUTH_SECRET          Mínimo 32 chars
BETTER_AUTH_URL             URL do backend
WEB_URL                     URL do frontend Next.js
APP_URL                     URL do app mobile
ANTHROPIC_API_KEY           API key da Anthropic
ASAAS_WEBHOOK_TOKEN         Token para validar webhooks do Asaas
ZAPI_WEBHOOK_TOKEN          Token para validar webhooks da ZAPI
ELEVENLABS_API_KEY          API key ElevenLabs
RESEND_API_KEY              API key Resend
FIREBASE_PROJECT_ID         Firebase project id
FIREBASE_CLIENT_EMAIL       Firebase service account email
FIREBASE_PRIVATE_KEY        Firebase service account private key
ENCRYPTION_KEY              32 bytes hex — openssl rand -hex 32
PORT                        Default 3001
NODE_ENV                    development | production
LOG_LEVEL                   info | debug | error
```

Todas validadas com Zod em src/config/env.ts no startup.
Usar sempre o objeto env exportado — nunca process.env diretamente fora de env.ts.

---

## Regras gerais de desenvolvimento

**Banco**
- Todos os UUIDs com gen_random_uuid()
- Todos os timestamps TIMESTAMPTZ DEFAULT now()
- Valores financeiros: DECIMAL(10,2), nunca FLOAT
- API keys e dados sensíveis: TEXT no banco, criptografados com encryption.ts
- ON DELETE CASCADE em FKs onde filho não faz sentido sem o pai
- Soft delete com is_active boolean (não deletar registros de negócio)

**Fastify**
- Plugins sempre com fp() do fastify-plugin
- Tipagem declarada em declare module 'fastify' de cada plugin
- Erros com fastify.httpErrors (never throw Error diretamente)
- Logs com req.log (never console.log)
- Schemas TypeBox em todas as rotas (body, params, querystring)
- tenantId sempre de req.tenantId — nunca do body

**Agente**
- temperature: 0 no Router e Guardrail
- temperature: stage_agent_config.temperature no Stage Agent (default 0.3)
- Máximo 5 iterações no tool loop
- Prompt caching nas camadas 1-4 do Stage Agent
- Mudança de status é determinística — nunca deixar o LLM decidir isso
- Webhooks sempre retornam 200 — erros são logados, nunca propagados como 5xx
- Confirmação obrigatória antes de create_appointment e generate_pix

**Multi-tenancy**
- Toda query inclui WHERE tenant_id = req.tenantId
- Índice em tenant_id em todas as tabelas
- Clientes diferentes são 100% isolados — nunca vazar dados entre tenants

---

## Modelos de IA e custo estimado

| Agente | Modelo | Tokens aprox | Uso |
|---|---|---|---|
| Router | claude-haiku-4-5 | ~300 input + 150 output | toda mensagem |
| Stage Agent | claude-sonnet-4-6 | ~1500 input + 300 output | ~60% das mensagens |
| Guardrail | claude-haiku-4-5 | ~500 input + 100 output | toda mensagem |
| Memory | claude-haiku-4-5 | ~600 input + 200 output | assíncrono pós-conversa |

Custo estimado por mensagem processada: ~$0.007-0.011 com prompt caching ativo.