# Playground — Frontend

## O que mudou no backend

- **Tenant:** campo `isAgentEnabledForWhatsApp` (default `false`). IA no WhatsApp só responde quando `true`. Toggle via `PATCH /v1/tenant` com `{ "isAgentEnabledForWhatsApp": true }`.
- **Agent:** `POST /v1/agent/message` aceita `testMode: true` — em modo teste não envia nada no WhatsApp.
- **Novo endpoint:** `GET /v1/agent/playground-contact` — retorna ou cria o contato de teste.
- Contato playground (`phone: "__playground__"`) não aparece em `GET /v1/contacts`.

---

## Endpoints

### GET `/v1/agent/playground-contact`
**Response 200**
```json
{ "id": "uuid", "phone": "__playground__", "name": "Playground", "currentStageId": "uuid", "currentFunnelId": "uuid" }
```

### POST `/v1/agent/playground-reset`
Apaga mensagens e memórias do contato de playground (Postgres + Firestore). Zera o contexto para testar de novo.

**Sem body.** Resposta `204 No Content`.

### POST `/v1/agent/message`
**Body**
```json
{ "contactId": "uuid", "message": "string", "testMode": true, "sessionId": "string" }
```
**Response 202**
```json
{ "jobId": "string", "status": "queued" }
```

### POST `/v1/agent/confirm`
**Body**
```json
{ "contactId": "uuid" }
```
**Response 200** — objeto com `status`, `reply`, `durationMs`

### GET `/v1/agent/job/:jobId`
**Response 200**
```json
{ "jobId": "string", "state": "completed", "result": { "status": "REPLIED", "reply": "...", ... }, "failedReason": null, "processedOn": 123, "finishedOn": 123 }
```

### GET `/v1/agent/audit?contactId=uuid&limit=20`
**Response 200**
```json
[{
  "id": "uuid",
  "status": "REPLIED",
  "routerIntent": "WANTS_SCHEDULE",
  "routerConfidence": 0.92,
  "stageAgentToolCalls": 2,
  "totalInputTokens": 1200,
  "totalOutputTokens": 150,
  "durationMs": 2500,
  "error": null,
  "auditDetails": [
    {
      "label": "Router",
      "detail": "Intent: WANTS_SCHEDULE (92% confiança)",
      "data": { "intent": "WANTS_SCHEDULE", "confidence": 0.92, "stage": "Novo Lead", "funnel": "Funil Principal" }
    },
    { "label": "Escalação", "detail": "Não necessária" },
    { "label": "Trigger", "detail": "Nenhum acionado" },
    {
      "label": "Stage Agent",
      "detail": "2 tool(s) executada(s): search_availability ✓, create_appointment ✓",
      "data": {
        "tools": ["search_availability", "create_appointment"],
        "toolExecutions": [
          {
            "tool": "search_availability",
            "input": { "date": "2026-03-10" },
            "success": true,
            "reason": null,
            "summary": "1 profissional(is), 12 slot(s) em 2026-03-10"
          },
          {
            "tool": "create_appointment",
            "input": { "professional_id": "abc12345...", "service_id": "def67890...", "scheduled_at": "2026-03-10T09:00:00-03:00" },
            "success": true,
            "reason": null,
            "summary": "Agendado para 2026-03-10T09:00:00.000Z"
          }
        ],
        "inputTokens": 1500,
        "outputTokens": 200
      }
    },
    { "label": "Guardrails", "detail": "Aprovado" },
    { "label": "Resultado", "detail": "Resposta salva (modo teste — não enviada no WhatsApp)" }
  ],
  "createdAt": "ISO8601"
}]
```

**Exibição sugerida (verboso):** Para cada item de `auditDetails`, exibir `label` + `detail`. Se `data.toolExecutions` existir, mostrar lista expandível com cada tool: nome, input resumido, success/falha, summary.

---

## Fluxo

1. `GET playground-contact` → obter `id`
2. `POST message` com `testMode: true` → `jobId`
3. Firestore `tenants/{tenantId}/contacts/{contactId}` `onSnapshot` → chat em tempo real
4. `POST confirm` quando houver confirmação pendente
5. `GET audit?contactId=` → painel com o que a IA fez
