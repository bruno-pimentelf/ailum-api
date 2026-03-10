# Funnels API — Referência Rápida

Base: `/v1/funnels` | Auth: `Bearer <session_token>` em todas as rotas.

---

## Funnels

```
GET    /v1/funnels           → lista funnels ativos com stages
POST   /v1/funnels           → cria funil
POST   /v1/funnels/default   → cria funil padrão (stages + IA + triggers)
PATCH  /v1/funnels/:id       → edita funil
DELETE /v1/funnels/:id       → desativa funil (soft delete)
```

### POST /v1/funnels/default

Cria o **Funil Principal** com os stages padrão (Novo Lead, Qualificado, Consulta Agendada, Atendido), configurações da IA (allowedTools, personality) e trigger de boas-vindas. Usar quando o tenant ainda não tem fluxo configurado ou para ter o funil recomendado (com create_appointment, etc.).

**Sem body.** Requer `FUNNELS_WRITE`. Resposta 201: funil criado com stages e agentConfig.

**PATCH /v1/funnels/:id body:**
```json
{ "name?", "description?", "order?", "isDefault?" }
```
`isDefault: true` — marca este funil como funil de entrada. Apenas um funil por tenant pode ser padrão. Novos contatos sem stage são atribuídos ao primeiro stage deste funil.

---

## Stages

```
GET    /v1/funnels/:funnelId/stages   → lista stages do funil
POST   /v1/funnels/:funnelId/stages   → cria stage
PATCH  /v1/funnels/stages/:stageId    → edita stage
DELETE /v1/funnels/stages/:stageId    → remove stage (erro se tiver contatos ativos)
```

**POST / PATCH body:**
```json
{ "name": "Novo contato", "color": "#3b82f6", "order": 0, "isTerminal": false }
```

> `isTerminal: true` marca o stage como final (ex: "Ganho", "Perdido"). Use para colorir diferente no UI.

---

## Mover Contato de Stage

```
PATCH /v1/contacts/:contactId/stage
{ "stageId": "uuid-do-stage" }
```

Atualiza `currentStageId`, `currentFunnelId` e `stageEnteredAt` no Postgres e sincroniza com Firestore automaticamente.

---

## Tipos

```ts
type ContactStatus =
  | 'NEW_LEAD' | 'ACTIVE' | 'QUALIFIED'
  | 'CONVERTED' | 'INACTIVE' | 'BLOCKED'
```

---

## Erros comuns

| Status | Motivo |
|---|---|
| 400 | Tentou deletar stage com contatos ativos |
| 404 | Stage não encontrado ou não pertence ao tenant |
| 409 | (futuro) conflito de order |
