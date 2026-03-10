# Checklist Backend → Frontend — Respostas

Respostas objetivas ao checklist para integração no frontend.

---

## 1. Triggers API

**Todos os endpoints existem:**

| Método | Rota | Status |
|--------|------|--------|
| GET | `/v1/funnels/stages/:stageId/triggers` | ✅ Existe |
| POST | `/v1/funnels/stages/:stageId/triggers` | ✅ Existe |
| PATCH | `/v1/funnels/triggers/:triggerId` | ✅ Existe |
| DELETE | `/v1/funnels/triggers/:triggerId` | ✅ Existe |
| PATCH | `/v1/funnels/triggers/:triggerId/toggle` | ✅ Existe |

### Response de listagem (GET triggers)
```json
[
  {
    "id": "uuid",
    "stageId": "uuid",
    "tenantId": "uuid",
    "event": "STAGE_ENTERED",
    "action": "SEND_MESSAGE",
    "actionConfig": { "useAI": false, "message": "Olá, tudo bem?..." },
    "conditionConfig": null,
    "delayMinutes": 0,
    "cooldownSeconds": 86400,
    "isActive": true,
    "createdAt": "..."
  }
]
```

### Body POST/PATCH trigger
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

### actionConfig por action

**SEND_MESSAGE:**
```json
{ "useAI": false, "message": "texto da mensagem" }
```
- `useAI: true` → IA personaliza o texto; use `message` como template. Variáveis: `{{name}}`, `{{appointmentTime}}`

**MOVE_STAGE:**
```json
{ "stageId": "uuid" }
```

**GENERATE_PIX:**
```json
{ "amount": 150, "description": "Consulta", "dueHours?": 24 }
```

### conditionConfig (ex.: AI_INTENT)
```json
{ "path": ["intent"], "equals": "WANTS_SCHEDULE" }
```

---

## 2. Tenant: agentBasePrompt e guardrailRules

**Implementado.**

- **GET /v1/tenant** — retorna `agentBasePrompt` e `guardrailRules`
- **PATCH /v1/tenant** — aceita `agentBasePrompt?: string | null`, `guardrailRules?: string | null`

---

## 3. Permissões

### 403
- Quando o usuário não tem permissão, o backend retorna **403** com `{ error: "Insufficient permissions", required: "funnels:write" }` (ou a permission necessária)

### Token/session e permissões
- **GET /v1/auth/me** retorna `{ role, tenant, memberId, professionalId, ... }` — use `role` para derivar permissões no frontend
- Mapeamento: ADMIN = tudo | SECRETARY = funis, agent, contacts, scheduling, billing, etc. | PROFESSIONAL = leitura de funis, scheduling próprio

**Roles e funis/triggers/agent:**
- **ADMIN** — todas as permissões
- **SECRETARY** — FUNNELS_READ, FUNNELS_WRITE, AGENT_CONFIG_READ, AGENT_CONFIG_WRITE
- **PROFESSIONAL** — FUNNELS_READ apenas (sem editar)

---

## 4. Detalhes conferidos

### GET /v1/funnels
Retorna:
```json
[
  {
    "id": "uuid",
    "name": "Funil Principal",
    "description": "...",
    "order": 0,
    "isActive": true,
    "stages": [
      {
        "id": "uuid",
        "name": "Novo Lead",
        "color": "#64748b",
        "order": 0,
        "isTerminal": false,
        "agentConfig": { ... },
        "triggers": [
          { "id": "uuid", "event": "STAGE_ENTERED", "action": "SEND_MESSAGE" }
        ]
      }
    ]
  }
]
```
- `stages[].agentConfig` — config completa do agente
- `stages[].triggers` — apenas `id`, `event`, `action` (sem `actionConfig`). Para ver/editar o conteúdo, use GET `/stages/:id/triggers`.

### actionConfig SEND_MESSAGE
O engine usa o campo `message`. O campo `template` (no seed) é equivalente — o engine usa `actionConfig.message ?? ''` como base. Para garantir, sempre envie `message`.

### Validação funnelId em PATCH /contacts/:id/stage
Sim. Se enviar `funnelId` no body e o `stageId` pertencer a outro funil, retorna **400** com `"Stage does not belong to the specified funnel"`.
