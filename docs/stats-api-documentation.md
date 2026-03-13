# Stats API — Documentação para o Frontend

Endpoints de estatísticas para o dashboard da clínica. Base: `GET /v1/stats`.

---

## Autenticação

Todos os endpoints exigem `Authorization: Bearer <token>` (JWT). O `tenantId` é resolvido automaticamente a partir do token.

---

## 1. GET /v1/stats/overview

Visão geral do dashboard (cards principais).

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| from | string (YYYY-MM-DD) | Não | Início do período (default: 1º dia do mês) |
| to | string (YYYY-MM-DD) | Não | Fim do período (default: último dia do mês) |
| professionalId | uuid | Não | Filtrar por profissional (ex.: agenda hoje) |

### Response 200

```json
{
  "leadsTotal": 42,
  "appointmentScheduledTotal": 15,
  "appointmentsToday": 3,
  "revenuePaid": 4500.5,
  "chargesOverdueCount": 2,
  "chargesOverdueAmount": 300,
  "escalationsCount": 1,
  "noShowRate": 8.5
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| leadsTotal | number | Contatos em NEW_LEAD ou QUALIFIED |
| appointmentScheduledTotal | number | Contatos com status APPOINTMENT_SCHEDULED |
| appointmentsToday | number | Consultas PENDING/CONFIRMED hoje |
| revenuePaid | number | Soma de cobranças PAID no período (from/to) |
| chargesOverdueCount | number | Cobranças OVERDUE |
| chargesOverdueAmount | number | Valor total das cobranças OVERDUE |
| escalationsCount | number | Escalações (IA → humano) no período |
| noShowRate | number | % de no-show (COMPLETED vs NO_SHOW no período) |

---

## 2. GET /v1/stats/funnel

Contatos por estágio do funil.

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| funnelId | uuid | Não | Filtrar por funil (default: todos os ativos) |

### Response 200

```json
{
  "byStage": [
    {
      "stageId": "uuid",
      "stageName": "Lead",
      "funnelName": "Vendas",
      "count": 25
    },
    {
      "stageId": "uuid",
      "stageName": "Qualificado",
      "funnelName": "Vendas",
      "count": 12
    }
  ]
}
```

---

## 3. GET /v1/stats/agenda

Consultas agrupadas por dia.

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| from | string (YYYY-MM-DD) | Não | Início (default: hoje) |
| to | string (YYYY-MM-DD) | Não | Fim (default: hoje) |
| professionalId | uuid | Não | Filtrar por profissional |

### Response 200

```json
{
  "byDay": [
    {
      "date": "2026-03-12",
      "total": 5,
      "pending": 1,
      "confirmed": 2,
      "completed": 1,
      "cancelled": 0,
      "noShow": 1
    },
    {
      "date": "2026-03-13",
      "total": 3,
      "pending": 0,
      "confirmed": 3,
      "completed": 0,
      "cancelled": 0,
      "noShow": 0
    }
  ]
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| date | string | Data (YYYY-MM-DD, timezone Brasília) |
| total | number | Total de consultas no dia |
| pending | number | Status PENDING |
| confirmed | number | Status CONFIRMED |
| completed | number | Status COMPLETED |
| cancelled | number | Status CANCELLED |
| noShow | number | Status NO_SHOW |

---

## 4. GET /v1/stats/revenue

Receita e cobranças.

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| from | string (YYYY-MM-DD) | Não | Início do período |
| to | string (YYYY-MM-DD) | Não | Fim do período |

### Response 200

```json
{
  "paid": 12500.0,
  "paidCount": 18,
  "pending": 2300.0,
  "pendingCount": 5,
  "overdue": 450.0,
  "overdueCount": 2
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| paid | number | Soma de cobranças PAID no período (paidAt) |
| paidCount | number | Quantidade de cobranças PAID |
| pending | number | Soma de cobranças PENDING (não depende de período) |
| pendingCount | number | Quantidade de cobranças PENDING |
| overdue | number | Soma de cobranças OVERDUE |
| overdueCount | number | Quantidade de cobranças OVERDUE |

---

## 5. GET /v1/stats/agent

Métricas do assistente de IA (WhatsApp/playground).

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| from | string (YYYY-MM-DD) | Não | Início do período |
| to | string (YYYY-MM-DD) | Não | Fim do período |

### Response 200

```json
{
  "messagesFromAgent": 342,
  "escalations": 8,
  "guardrailViolations": 2,
  "guardrailBlocked": 1,
  "resolutionRate": 94.5,
  "totalInputTokens": 125000,
  "totalOutputTokens": 42000
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| messagesFromAgent | number | Mensagens enviadas pela IA no período |
| escalations | number | Casos escalados para humano |
| guardrailViolations | number | Total de violações de guardrail |
| guardrailBlocked | number | Violações que resultaram em bloqueio |
| resolutionRate | number | % de resolução pela IA (sem escalação/erro) |
| totalInputTokens | number | Tokens de entrada (estimativa de custo) |
| totalOutputTokens | number | Tokens de saída (estimativa de custo) |

---

## Datas e timezone

- Todas as datas usam timezone **America/Sao_Paulo** (Brasília).
- Formato de datas: `YYYY-MM-DD`.
- Se `from`/`to` não forem enviados, o período padrão é o mês atual (exceto em `/agenda`, que usa hoje).

---

## Exemplo de uso (fetch)

```typescript
const token = '...' // JWT

// Overview do mês
const overview = await fetch('/v1/stats/overview', {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())

// Agenda da semana
const agenda = await fetch('/v1/stats/agenda?from=2026-03-10&to=2026-03-16', {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())

// Receita do mês
const revenue = await fetch('/v1/stats/revenue?from=2026-03-01&to=2026-03-31', {
  headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())
```
