# Modo Playground — IA em teste sem afetar WhatsApp

## O que precisa para a IA funcionar

- **ANTHROPIC_API_KEY** no `.env` — sem isso o agent job retorna `skipped`.
- **Redis** — BullMQ usa para filas.
- **Firebase** (Firestore) — mensagens e presença em tempo real.
- **Dados mínimos** — tenant com `agentBasePrompt`, funil com stages e `stageAgentConfig`, contato com `currentStageId` (ou contato de playground num stage).
- **Opcional** — Z-API configurada para envio no WhatsApp (no modo teste isso não é usado).

## Situação atual

| Origem | Fluxo |
|--------|-------|
| **WhatsApp** | Webhook Z-API → `agentQueue.add` → orchestrate → salva DB + Firestore + **envia resposta no WhatsApp** |
| **POST /v1/agent/message** | Enfileira igual → mesma pipeline → **também envia no WhatsApp** (se o contato tiver phone e o tenant tiver Z-API) |

- Toda mensagem do contato no WhatsApp dispara o agente.
- Não existe flag para desligar o agente no WhatsApp.
- Não existe “modo teste” que rode só no playground sem enviar nada no WhatsApp.

## O que você quer

1. **Playground** — conversar com a IA no front (chat de teste) sem mandar nada no WhatsApp.
2. **WhatsApp desligado** — mensagens no WhatsApp não acionam o agente.
3. **Independentes** — Playground funciona mesmo com o agente desligado no WhatsApp.

## O que falta implementar

### 1. Flag por tenant: agente no WhatsApp

- Campo no tenant: `isAgentEnabledForWhatsApp` (boolean, default `false`).
- No webhook Z-API, ao receber mensagem: se `isAgentEnabledForWhatsApp === false` → **não** faz `agentQueue.add`.
- Enquanto estiver `false`, nenhuma mensagem do WhatsApp dispara o agente.

### 2. Modo teste no agente

- `POST /v1/agent/message` aceita `testMode?: boolean` no body.
- Se `testMode: true`:
  - Job roda a IA normal.
  - Salva em DB + Firestore (para o chat aparecer no playground).
  - **Não envia** resposta via Z-API/WhatsApp.
- O orchestrator recebe essa flag e ignora o bloco de envio ao WhatsApp quando `testMode === true`.

### 3. Contato de playground

- Um contato por tenant usado só no playground (ex.: `phone: "__playground__"`).
- O front faz `POST /v1/agent/message` com esse `contactId` e `testMode: true`.
- Pode ser criado no seed ou on-demand na primeira vez que o usuário abre o playground.

---

## Resumo

| Modo | Origem | Agente roda? | Envia no WhatsApp? |
|------|--------|--------------|--------------------|
| **Playground** | `POST /v1/agent/message` com `testMode: true` | Sim | Não |
| **WhatsApp** | Webhook Z-API | Só se `isAgentEnabledForWhatsApp` | Sim (quando estiver ativo) |

Playground e WhatsApp ficam separados: o modo teste roda só no playground e não interfere nas respostas do WhatsApp.

---

## Implementado (backend)

1. [x] Migration: `isAgentEnabledForWhatsApp` em `tenants` (default `false`).
2. [x] Webhook Z-API: checa a flag antes de enfileirar o agente.
3. [x] `POST /v1/agent/message`: aceita `testMode` no body.
4. [x] Job `agent`: repassa `testMode` para `orchestrate`.
5. [x] Orchestrator: não chama Z-API quando `testMode === true`.
6. [x] `confirmAndExecute`: lê `testMode` do state em Redis, não envia no teste.
7. [x] `GET /v1/agent/playground-contact`: retorna ou cria o contato de playground.
8. [x] Tool `send_message`: não envia via Z-API quando `testMode`.
9. [x] Contato `__playground__` excluído da listagem de contatos.

## API Playground (frontend)

```
GET  /v1/agent/playground-contact     → { id, phone, name, currentStageId, currentFunnelId }

POST /v1/agent/message
{ "contactId": "<playground.id>", "message": "Olá", "testMode": true }
→ 202 { jobId } — poll GET /v1/agent/job/:jobId para ver resultado

POST /v1/agent/confirm                (quando confirmação pendente)
{ "contactId": "<playground.id>" }
```

Mensagens aparecem no Firestore em `tenants/{tenantId}/contacts/{contactId}` — usar `onSnapshot` para tempo real.

## Pendente (frontend)

- Tela de playground que usa essas APIs e exibe o chat via Firestore.

---

## Templates de mensagem

Templates configurados em `/v1/templates` podem ser usados em lembretes e triggers. Os lembretes (`reminder_24h`, `reminder_1h`) aparecem no chat do playground quando o contato for `__playground__` — a mensagem é salva no DB e sincronizada no Firestore, sem envio via WhatsApp.
