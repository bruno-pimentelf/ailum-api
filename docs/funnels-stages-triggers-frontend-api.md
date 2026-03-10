# Funis, Stages e Triggers — API Completa para o Frontend

Tudo que você precisa para editar funis, stages, config do agente e triggers pela interface.

**Base URL:** `/v1/funnels` (com `Authorization: Bearer <session_token>`)

---

## 1. Funis

### Listar funis
```
GET /v1/funnels
```
**Response 200:** `Funnel[]` com `stages[]` (inclui agentConfig e triggers resumidos)

### Criar funil vazio
```
POST /v1/funnels
Content-Type: application/json

{ "name": "string", "description?: "string", "order?: 0 }
```

### Criar funil padrão (Novo Lead, Qualificado, etc.)
```
POST /v1/funnels/default
```
**Body:** vazio. Cria "Funil Principal" com stages e 1 trigger STAGE_ENTERED.

### Atualizar funil
```
PATCH /v1/funnels/:funnelId
{ "name?", "description?", "order?", "isDefault?" }
```
`isDefault: true` marca este funil como funil de entrada (único por tenant). Novos contatos sem stage são atribuídos ao primeiro stage deste funil.

### Excluir funil (soft delete)
```
DELETE /v1/funnels/:funnelId
```

---

## 2. Stages

### Listar stages de um funil
```
GET /v1/funnels/:funnelId/stages
```
**Response:** `Stage[]` com `agentConfig`, `triggers`

### Criar stage
```
POST /v1/funnels/:funnelId/stages
{ "name": "string", "color?": "#64748b", "order": 0, "isTerminal?": false }
```

### Atualizar stage
```
PATCH /v1/funnels/stages/:stageId
{ "name?", "color?", "order?", "isTerminal?" }
```

### Excluir stage
```
DELETE /v1/funnels/stages/:stageId
```
**Nota:** Falha se houver contatos nesse stage.

---

## 3. Stage Agent Config (Config do Agente por Stage)

### Obter config
```
GET /v1/funnels/stages/:stageId/agent-config
```
**Response 200:**
```json
{
  "id": "uuid",
  "stageId": "uuid",
  "funnelAgentName": "Recepção",
  "funnelAgentPersonality": "Você é da recepção...",
  "stageContext": "Contato inicial...",
  "allowedTools": ["search_availability", "create_appointment", "move_stage", "send_message", "notify_operator"],
  "model": "SONNET",
  "temperature": 0.4,
  "createdAt": "...",
  "updatedAt": "..."
}
```
**404** — stage sem config

### Salvar config (upsert)
```
PUT /v1/funnels/stages/:stageId/agent-config
Content-Type: application/json
```
**Body** (todos opcionais):
```json
{
  "funnelAgentName": "string",
  "funnelAgentPersonality": "string",
  "stageContext": "string",
  "allowedTools": ["string"],
  "model": "HAIKU | SONNET",
  "temperature": 0.3
}
```

| Campo | Descrição |
|-------|-----------|
| `funnelAgentName` | Nome do assistente (ex: "Recepção") — evite "assistente virtual" |
| `funnelAgentPersonality` | Tom e personalidade — evite "assistente virtual", "bot", emojis |
| `stageContext` | Instruções do estágio |
| `allowedTools` | `search_availability`, `create_appointment`, `generate_pix`, `move_stage`, `notify_operator`, `send_message` |
| `model` | `HAIKU` ou `SONNET` |
| `temperature` | 0–1 (0.3–0.4 recomendado) |

---

## 4. Triggers

Os triggers enviam mensagens automáticas (ex: ao entrar no stage). A mensagem de boas-vindas "assistente virtual" vem de um trigger STAGE_ENTERED.

### Listar triggers de um stage
```
GET /v1/funnels/stages/:stageId/triggers
```
**Response:** `Trigger[]`

### Criar trigger
```
POST /v1/funnels/stages/:stageId/triggers
Content-Type: application/json
```
**Body:**
```json
{
  "event": "STAGE_ENTERED | STALE_IN_STAGE | PAYMENT_CONFIRMED | APPOINTMENT_APPROACHING | AI_INTENT | MESSAGE_RECEIVED",
  "action": "SEND_MESSAGE | MOVE_STAGE | GENERATE_PIX | NOTIFY_OPERATOR | WAIT_AND_REPEAT",
  "actionConfig": { ... },
  "conditionConfig?": { ... },
  "delayMinutes?": 0,
  "cooldownSeconds?": 3600
}
```

### Atualizar trigger
```
PATCH /v1/funnels/triggers/:triggerId
```
**Body:** mesmo schema, campos opcionais.

### Excluir trigger
```
DELETE /v1/funnels/triggers/:triggerId
```

### Ativar/desativar trigger
```
PATCH /v1/funnels/triggers/:triggerId/toggle
```
Alterna `isActive`.

---

## 5. actionConfig para SEND_MESSAGE

Quando `action === "SEND_MESSAGE"`:

```json
{
  "useAI": false,
  "message": "Olá, tudo bem? Que bom falar com você. Como posso ajudar hoje?"
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `useAI` | boolean | `false` = envia a mensagem exata; `true` = IA personaliza (usa template) |
| `message` | string | Mensagem fixa — **evite "assistente virtual", emojis** |
| `template` | string | Usado quando `useAI: true`. Variáveis: `{{name}}`, `{{appointmentTime}}` |

**Exemplo correto ( humano, sem emojis ):**
```json
{
  "useAI": false,
  "message": "Olá, tudo bem? Que bom falar com você. Como posso ajudar hoje?"
}
```

**Exemplo a evitar:**
```json
{
  "useAI": false,
  "message": "Olá! Sou o assistente virtual da clínica 👋"
}
```

---

## 6. actionConfig para outras actions

**MOVE_STAGE:**
```json
{ "stageId": "uuid-do-stage-destino" }
```

**GENERATE_PIX:**
```json
{ "amount": 150, "description": "Consulta" }
```

**AI_INTENT (conditionConfig):**
```json
{ "path": ["intent"], "equals": "WANTS_SCHEDULE" }
```

---

## 7. Sugestão de telas no frontend

### Tela: Editar Stage
- Dados do stage: nome, cor (PATCH stages/:id)
- Seção "Config do Agente": GET/PUT agent-config com todos os campos (funnelAgentName, funnelAgentPersonality, stageContext, allowedTools, model, temperature)

### Tela: Triggers do Stage
- Lista: GET stages/:id/triggers
- Criar: POST stages/:id/triggers
- Editar: PATCH triggers/:id — incluir campo `message` (textarea) para SEND_MESSAGE
- Excluir: DELETE triggers/:id
- Toggle ativo: PATCH triggers/:id/toggle

### Navegação típica
```
Funis → [Funnel] → Stages → [Stage] → Editar
                              ↓
                    Triggers | Agent Config
```

---

## 9. Tenant (agentBasePrompt, guardrailRules)

### GET /v1/tenant
Retorna o tenant com `agentBasePrompt` e `guardrailRules` (incluídos no select).

### PATCH /v1/tenant
```
PATCH /v1/tenant
{ "agentBasePrompt"?: string | null, "guardrailRules"?: string | null, ... }
```
Para limpar: envie `null`. Evite "assistente virtual" e emojis.

---

## 10. Permissões

- `FUNNELS_READ` — listar funis, stages, triggers, board
- `FUNNELS_WRITE` — criar/editar/excluir funis, stages, triggers
- `AGENT_CONFIG_READ` — GET agent-config
- `AGENT_CONFIG_WRITE` — PUT agent-config
