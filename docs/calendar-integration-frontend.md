# Calendário e Serviços — Guia de Integração Frontend

Auth: `Bearer <session_token>` em todas as rotas.

---

## Visão geral

- **Calendário por profissional:** um profissional (ou admin em nome dele) vê só os agendamentos daquele profissional.
- **Calendário da clínica:** visão com todos os profissionais; filtro opcional por profissional.
- **Serviços:** lista de serviços; os marcados como consulta (`isConsultation: true`) entram no fluxo de agendamento (incl. IA).

---

## 1. Calendário por profissional

**Quem usa:** PROFESSIONAL (próprio calendário) ou ADMIN/SECRETARY (calendário de qualquer profissional).

### Listar agendamentos de um profissional

```
GET /v1/scheduling?professionalId={uuid}&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=50
```

**Query:**

| Campo          | Tipo   | Descrição                          |
|----------------|--------|------------------------------------|
| professionalId | uuid   | Filtra por profissional            |
| from           | date   | Início do período                  |
| to             | date   | Fim do período                     |
| status         | string | PENDING, CONFIRMED, CANCELLED, etc |
| contactId      | uuid   | Filtra por contato                 |
| page, limit    | number | Paginação                          |

**Resposta:**

```json
{
  "data": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "contactId": "uuid",
      "professionalId": "uuid",
      "serviceId": "uuid",
      "scheduledAt": "2025-03-15T14:00:00.000Z",
      "durationMin": 50,
      "status": "CONFIRMED",
      "notes": null,
      "contact": { "id": "uuid", "name": "...", "phone": "..." },
      "professional": { "id": "uuid", "fullName": "Dr. João" },
      "service": { "id": "uuid", "name": "Consulta", "durationMin": 50 },
      "charge": { "id": "uuid", "status": "PAID", "amount": 150 }
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "pages": 3
}
```

**Comportamento por role:**

- **PROFESSIONAL:** se não enviar `professionalId`, o backend usa o do membro (`req.professionalId`) e retorna só os agendamentos dele.
- **ADMIN / SECRETARY:** podem enviar qualquer `professionalId` ou omitir para ver todos.

**Fluxo sugerido (calendário do profissional):**

1. Obter `professionalId`: do `GET /v1/auth/me` (campo `professionalId`) para “meu calendário”, ou da lista de profissionais para admin.
2. Chamar `GET /v1/scheduling?professionalId=...&from=...&to=...`.
3. Renderizar eventos no calendário (um evento = um item de `data`).

---

## 2. Calendário da clínica (visão geral)

**Quem usa:** ADMIN ou SECRETARY.

### Listar todos os agendamentos (sem filtro de profissional)

```
GET /v1/scheduling?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=100
```

Não envie `professionalId`; a resposta traz agendamentos de todos os profissionais.

### Opcional: filtro por profissional

Para aba ou dropdown “Ver só Dr. X”:

```
GET /v1/scheduling?professionalId={uuid}&from=...&to=...
```

### Dados para a visão geral

1. **Lista de profissionais (para legendas/cores):**
   ```
   GET /v1/professionals
   ```
   Cada profissional tem `id`, `fullName`, `calendarColor` — use para cores por profissional na visão geral.

2. **Agendamentos:**
   ```
   GET /v1/scheduling?from=...&to=...
   ```

3. **Firestore (tempo real):**  
   Os agendamentos são espelhados em `tenants/{tenantId}/appointments/{appointmentId}`. Use `onSnapshot` nessa coleção (ou nos documentos dos profissionais que você exibe) para atualizar o calendário em tempo real.

---

## 3. Slots disponíveis (ao criar/agendar)

Antes de criar um agendamento, é preciso escolher data/hora. Slots livres por profissional e dia:

```
GET /v1/scheduling/professionals/:professionalId/availability?date=YYYY-MM-DD&serviceId={uuid}
```

**Resposta:**

```json
{
  "slots": [
    { "time": "09:00", "endTime": "09:50", "scheduledAt": "2025-03-15T12:00:00.000Z" }
  ],
  "professional": { "id": "uuid", "fullName": "Dr. João" }
}
```

Se o dia estiver bloqueado (exceção) ou sem disponibilidade:

```json
{
  "slots": [],
  "reason": "Profissional indisponível nesta data"
}
```

**Fluxo criar agendamento:**

1. Usuário escolhe profissional, serviço e data.
2. `GET /v1/scheduling/professionals/{id}/availability?date=YYYY-MM-DD&serviceId=...` → exibir `slots`.
3. Usuário escolhe um slot; montar `scheduledAt` em ISO (ex.: usar `scheduledAt` do slot).
4. `POST /v1/scheduling` (ver abaixo).

---

## 4. Criar / editar / cancelar agendamento

### Criar

```
POST /v1/scheduling
Content-Type: application/json

{
  "contactId": "uuid",
  "professionalId": "uuid",
  "serviceId": "uuid",
  "scheduledAt": "2025-03-15T14:00:00.000Z",
  "durationMin": 50,
  "notes": "Opcional"
}
```

**Resposta 201:** objeto do agendamento criado (com `contact`, `professional`, `service`).

### Atualizar (status, data, notas)

```
PATCH /v1/scheduling/:id

{
  "status": "CONFIRMED",
  "scheduledAt": "2025-03-15T15:00:00.000Z",
  "notes": "...",
  "cancelledReason": "..."
}
```

Status: `PENDING` | `CONFIRMED` | `CANCELLED` | `COMPLETED` | `NO_SHOW`.

### Cancelar

```
DELETE /v1/scheduling/:id
```

Ou `PATCH /v1/scheduling/:id` com `"status": "CANCELLED"` e opcionalmente `cancelledReason`.

---

## 5. Serviços — mudanças e uso no calendário

### Campo novo: `isConsultation`

Serviços que são **consultas** (agendáveis) devem ter `isConsultation: true`. Só esses entram na IA e fazem sentido no calendário.

| Campo          | Tipo    | POST | PATCH | Descrição                          |
|----------------|---------|------|-------|------------------------------------|
| name           | string  | ✅   | opcional | Nome do serviço                 |
| description    | string  | opcional | opcional | Descrição                      |
| durationMin    | number  | opcional (50) | opcional | Duração em minutos            |
| price          | number  | ✅   | opcional | Preço                          |
| **isConsultation** | boolean | opcional (true) | opcional | Se é consulta (agendável)   |

### POST criar serviço

```json
{
  "name": "Consulta inicial",
  "description": "Primeira consulta",
  "durationMin": 50,
  "price": 250.00,
  "isConsultation": true
}
```

### PATCH editar serviço

```json
{
  "name": "Retorno",
  "isConsultation": true
}
```

### GET lista/detalhe

A resposta de `GET /v1/services` e `GET /v1/services/:id` passa a incluir:

```ts
{
  id: string
  name: string
  description: string | null
  durationMin: number
  price: number
  isActive: boolean
  isConsultation: boolean   // novo
  createdAt: string
}
```

### Uso no frontend

- **Cadastro de serviços:** permitir marcar/desmarcar “É consulta” (checkbox) e enviar `isConsultation` no POST/PATCH.
- **Telas de agendamento:** ao listar serviços para escolher no agendamento (ou para a IA), filtrar por `isConsultation === true`. A API de slots já usa o serviço para `durationMin`; manter só consultas evita confusão.

---

## 6. Resumo de endpoints

| Uso | Método | Rota |
|-----|--------|------|
| Listar agendamentos (com filtro profissional) | GET | `/v1/scheduling?professionalId=&from=&to=` |
| Detalhe agendamento | GET | `/v1/scheduling/:id` |
| Criar agendamento | POST | `/v1/scheduling` |
| Atualizar agendamento | PATCH | `/v1/scheduling/:id` |
| Cancelar agendamento | DELETE | `/v1/scheduling/:id` |
| Slots livres (um dia, um profissional) | GET | `/v1/scheduling/professionals/:id/availability?date=&serviceId=` |
| Listar profissionais (cores/nomes) | GET | `/v1/professionals` |
| Disponibilidade semanal do profissional | GET | `/v1/professionals/:id/availability` |
| Listar serviços | GET | `/v1/services` |
| Detalhe serviço | GET | `/v1/services/:id` |
| Criar/editar serviço (com isConsultation) | POST/PATCH | `/v1/services`, `/v1/services/:id` |

---

## 7. Firestore (tempo real)

- **Agendamentos:** `tenants/{tenantId}/appointments/{appointmentId}`  
  Campos: `id`, `contactId`, `professionalId`, `serviceId`, `scheduledAt`, `durationMin`, `status`, `notes`, `updatedAt`.  
  Use `onSnapshot` para atualizar o calendário quando um agendamento for criado/alterado/cancelado (pela API ou pela IA).

---

## 8. Fluxos resumidos

**Calendário “meu” (profissional):**  
`GET /v1/auth/me` → `professionalId` → `GET /v1/scheduling?professionalId=...&from=&to=` → renderizar.

**Calendário da clínica:**  
`GET /v1/professionals` (cores/nomes) + `GET /v1/scheduling?from=&to=` (todos) → renderizar; opcional filtro por `professionalId`.

**Novo agendamento:**  
Escolher profissional e serviço (consultas) → `GET /v1/scheduling/professionals/:id/availability?date=&serviceId=` → escolher slot → `POST /v1/scheduling`.

**Serviços:**  
Listar com `isConsultation`; no cadastro, enviar `isConsultation`; nas telas de agendamento, usar apenas serviços com `isConsultation: true`.
