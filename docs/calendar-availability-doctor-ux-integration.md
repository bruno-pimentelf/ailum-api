# Calendário do Médico — UX e Integração Frontend

Guia completo para a tela do profissional ver e configurar sua disponibilidade e ver seus appointments na **mesma interface**.

Auth: `Bearer <session_token>` em todas as rotas.  
Base: `/v1/professionals` e `/v1/scheduling`.

---

## 1. Objetivo da tela

O médico deve conseguir, em **um único calendário**:

1. **Ver** sua disponibilidade (quando está disponível para atender)
2. **Configurar** essa disponibilidade (grade semanal, bloqueios, horários específicos)
3. **Ver** os appointments que estão nas datas e se cruzam com os blocos de disponibilidade

Tudo na mesma tela, sem trocar de aba ou contexto.

---

## 2. UX — Guia detalhado para o médico

### 2.1 Princípios gerais

- **Calendário único** com disponibilidade e appointments juntos.
- **Cores e estilos distintos** para cada tipo de informação.
- **Edição em contexto**: clicar no dia/horário e editar sem sair do calendário (modal, drawer ou inline).
- **Feedback imediato**: ao salvar, atualizar a interface sem recarregar a página inteira.

---

### 2.2 Camadas visuais no calendário

| Tipo | Visual sugerido | Descrição |
|------|-----------------|-----------|
| **Disponibilidade (grade semanal)** | Blocos cinza semi-transparente ou azul claro | Ex.: seg 9h–12h, 14h–18h |
| **Disponibilidade (override)** | Blocos verdes ou azul diferente | Horário extra em data específica |
| **Dia bloqueado** (exceção ou block range) | Listras vermelhas ou cinza escuro com ícone de cadeado | Ex.: feriado, férias |
| **Appointment confirmado** | Cor sólida (ex.: azul) | Consulta agendada |
| **Appointment pendente** | Borda tracejada ou cor mais suave | Aguardando confirmação |
| **Dia sem disponibilidade** | Cinza bem leve ou "Sem agenda" | Ex.: domingo sem override |

---

### 2.3 Modos de visualização

- **Semana**: melhor para configurar horários e ver appointments dia a dia.
- **Mês**: melhor para visão geral e bloquear intervalos (férias).
- **Toggle** entre semana/mês no topo da tela.

---

### 2.4 Interações principais

#### Ver disponibilidade

- **Ao abrir a tela**: mostrar os blocos de disponibilidade de fundo e os appointments em cima.
- **Legenda fixa** no rodapé: `Disponível | Bloqueado | Override | Consultas confirmadas | Pendentes`.

#### Configurar grade semanal

- **Botão "Configurar horários da semana"** ou painel lateral.
- Exibir grade com os dias da semana e permitir adicionar/remover blocos (ex.: seg 9h–12h e 14h–18h).
- Horários em **incrementos de 5 minutos** (09:00, 09:05, 09:10 …).

#### Bloquear dia específico

- Clicar no **dia** (não no horário).
- Menu ou modal: "Bloquear dia" → motivo opcional (ex.: "Consulta externa").
- Chama `POST /professionals/:id/exceptions`.

#### Bloquear intervalo (férias, licença)

- Selecionar **intervalo de datas** (shift+click ou "De X até Y").
- Modal: "Bloquear período" → motivo opcional.
- Chama `POST /professionals/:id/block-ranges`.

#### Adicionar horário em data específica

- Ex.: "Sábado 15/03 9h–12h" sem ter sábado na grade semanal.
- Clicar no dia → "Adicionar horário neste dia" → escolher início e fim.
- Chama `POST /professionals/:id/overrides`.

#### Ver detalhes do appointment

- Clicar no **appointment** → modal ou drawer com:
  - Paciente
  - Serviço
  - Horário
  - Status
  - Ações: confirmar, cancelar, reagendar.

---

### 2.5 Resumo no topo (opcional)

- "X slots livres esta semana"
- "Y consultas agendadas"
- Badge de aviso se houver appointments fora da disponibilidade (inconsistência).

---

### 2.6 Detecção de inconsistências

- Se um appointment está **fora** de qualquer bloco de disponibilidade do dia, destacar (borda amarela ou aviso).
- Ex.: profissional bloqueou o dia depois de marcar consulta → mostrar aviso e opção de reagendar ou desbloquear.

---

## 3. Integração — Fluxo de dados

### 3.1 O que carregar ao abrir a tela

1. **Perfil + disponibilidade completa**
   ```
   GET /v1/professionals/:id
   ```
   Retorna: `availability`, `availabilityExceptions`, `availabilityOverrides`, `availabilityBlockRanges`.

2. **Appointments do período**
   ```
   GET /v1/scheduling?professionalId=:id&from=YYYY-MM-DD&to=YYYY-MM-DD
   ```

3. **Opcional — tempo real**
   - Firestore: `tenants/{tenantId}/appointments` (ou coleção equivalente).
   - `onSnapshot` para atualizar appointments em tempo real.

---

### 3.2 Cálculo de disponibilidade por dia (frontend)

Para cada dia `YYYY-MM-DD` e `professionalId`:

```
1. Se existe exceção com date = YYYY-MM-DD → DIA BLOQUEADO
2. Se existe block range com dateFrom ≤ YYYY-MM-DD ≤ dateTo → DIA BLOQUEADO
3. Se existe override com date = YYYY-MM-DD → usar horários do(s) override(s)
4. Caso contrário → usar availability onde dayOfWeek = dia da semana (0–6)
```

**dayOfWeek**: 0 = Domingo, 1 = Segunda, … 6 = Sábado.

---

### 3.3 Renderização dos blocos

Para cada dia do calendário visível:

- Se **bloqueado**: renderizar faixa/overlay "Indisponível".
- Se **com disponibilidade**: para cada bloco (startTime–endTime), desenhar um retângulo na coluna de horários. Os appointments vão **por cima** desses blocos.
- Se **sem disponibilidade** e sem bloqueio: opcional exibir "Sem agenda" ou deixar em branco.

---

## 4. API — Rotas completas

### 4.1 Profissionais e disponibilidade

#### GET /v1/professionals/:id

Retorna o profissional com toda a disponibilidade.

**Resposta 200:**

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "fullName": "Dr. João",
  "specialty": "Fisioterapia",
  "bio": null,
  "avatarUrl": null,
  "calendarColor": "#3b82f6",
  "availability": [
    {
      "id": "uuid",
      "dayOfWeek": 1,
      "startTime": "09:00",
      "endTime": "18:00",
      "slotDurationMin": 50
    },
    {
      "id": "uuid",
      "dayOfWeek": 3,
      "startTime": "14:00",
      "endTime": "20:00",
      "slotDurationMin": 50
    }
  ],
  "availabilityExceptions": [
    {
      "id": "uuid",
      "date": "2025-12-25T00:00:00.000Z",
      "isUnavailable": true,
      "reason": "Natal"
    }
  ],
  "availabilityOverrides": [
    {
      "id": "uuid",
      "date": "2025-03-15T00:00:00.000Z",
      "startTime": "09:00",
      "endTime": "12:00",
      "slotDurationMin": 50
    }
  ],
  "availabilityBlockRanges": [
    {
      "id": "uuid",
      "dateFrom": "2025-04-01T00:00:00.000Z",
      "dateTo": "2025-04-15T00:00:00.000Z",
      "reason": "Férias"
    }
  ]
}
```

**dayOfWeek**: 0 = Domingo, 1 = Segunda, … 6 = Sábado.

---

#### GET /v1/professionals/:id/availability

Retorna só a grade semanal (recorrente).

**Resposta 200:**

```json
[
  {
    "id": "uuid",
    "professionalId": "uuid",
    "dayOfWeek": 1,
    "startTime": "09:00",
    "endTime": "18:00",
    "slotDurationMin": 50
  }
]
```

---

#### PUT /v1/professionals/:id/availability

Define a grade semanal. **Substitui** todas as faixas existentes. Array vazio remove tudo.

**Body:**

```json
[
  {
    "dayOfWeek": 1,
    "startTime": "09:00",
    "endTime": "18:00",
    "slotDurationMin": 50
  },
  {
    "dayOfWeek": 3,
    "startTime": "14:00",
    "endTime": "20:00",
    "slotDurationMin": 50
  }
]
```

| Campo           | Tipo   | Obrigatório | Descrição                                                                 |
|-----------------|--------|-------------|---------------------------------------------------------------------------|
| dayOfWeek       | 0–6    | ✅          | Domingo=0, Segunda=1, …                                                   |
| startTime       | HH:mm  | ✅          | Incrementos de 5 min: 00, 05, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55      |
| endTime         | HH:mm  | ✅          | Idem                                                                      |
| slotDurationMin | number | Não (50)    | Duração do slot em minutos (5–120)                                        |

**Resposta 200:** array igual ao GET availability.

---

#### POST /v1/professionals/:id/exceptions

**Bloqueio total** (dia inteiro) ou **bloqueio parcial** (slotMask).

**Bloqueio total:**
```json
{
  "date": "2025-12-25",
  "isUnavailable": true,
  "reason": "Natal"
}
```

**Bloqueio parcial** (excluir horários da grade semanal naquela data):
```json
{
  "date": "2025-03-11",
  "isUnavailable": false,
  "slotMask": [
    { "startTime": "09:00", "endTime": "12:00" }
  ]
}
```

| Campo         | Tipo    | Obrigatório | Descrição                                                                    |
|---------------|---------|-------------|------------------------------------------------------------------------------|
| date          | YYYY-MM-DD | ✅       | Data                                                                         |
| isUnavailable | boolean | Não (true)  | true = dia inteiro bloqueado; false = usar slotMask para bloqueios parciais   |
| reason        | string  | Não         | Ex.: "Natal"                                                                 |
| slotMask      | array   | Não         | Só com isUnavailable=false. Janelas a remover: `[{ startTime, endTime }]`     |

**Resposta 201:** Objeto da exceção (com `slotMask` quando aplicável).

---

#### DELETE /v1/professionals/:id/exceptions/:date

Remove bloqueio de um dia.

**Parâmetros:** `date` = YYYY-MM-DD

**Resposta:** `204 No Content`

---

#### POST /v1/professionals/:id/overrides

Adiciona disponibilidade em **data específica** (ex.: sábado 15/03 9h–12h).

**Body:**

```json
{
  "date": "2025-03-15",
  "startTime": "09:00",
  "endTime": "12:00",
  "slotDurationMin": 50
}
```

| Campo           | Tipo   | Obrigatório | Descrição                         |
|-----------------|--------|-------------|-----------------------------------|
| date            | YYYY-MM-DD | ✅      | Data                              |
| startTime       | HH:mm  | ✅          | Incrementos de 5 min              |
| endTime         | HH:mm  | ✅          | Idem                              |
| slotDurationMin | number | Não (50)    | Duração do slot em minutos        |

**Resposta 201:**

```json
{
  "id": "uuid",
  "professionalId": "uuid",
  "date": "2025-03-15T00:00:00.000Z",
  "startTime": "09:00",
  "endTime": "12:00",
  "slotDurationMin": 50
}
```

---

#### GET /v1/professionals/:id/overrides

Lista overrides. Query opcional: `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

**Resposta 200:**

```json
[
  {
    "id": "uuid",
    "professionalId": "uuid",
    "date": "2025-03-15T00:00:00.000Z",
    "startTime": "09:00",
    "endTime": "12:00",
    "slotDurationMin": 50
  }
]
```

---

#### DELETE /v1/professionals/:id/overrides/:overrideId

Remove override por ID.

**Resposta:** `204 No Content`

---

#### POST /v1/professionals/:id/block-ranges

Bloqueia um **intervalo de datas** (ex.: férias).

**Body:**

```json
{
  "dateFrom": "2025-04-01",
  "dateTo": "2025-04-15",
  "reason": "Férias"
}
```

| Campo   | Tipo      | Obrigatório | Descrição          |
|---------|-----------|-------------|--------------------|
| dateFrom| YYYY-MM-DD| ✅          | Início             |
| dateTo  | YYYY-MM-DD| ✅          | Fim (≥ dateFrom)   |
| reason  | string    | Não         | Ex.: "Férias"      |

**Resposta 201:**

```json
{
  "id": "uuid",
  "professionalId": "uuid",
  "dateFrom": "2025-04-01T00:00:00.000Z",
  "dateTo": "2025-04-15T00:00:00.000Z",
  "reason": "Férias"
}
```

---

#### GET /v1/professionals/:id/block-ranges

Lista blocos de datas bloqueadas.

**Resposta 200:**

```json
[
  {
    "id": "uuid",
    "professionalId": "uuid",
    "dateFrom": "2025-04-01T00:00:00.000Z",
    "dateTo": "2025-04-15T00:00:00.000Z",
    "reason": "Férias"
  }
]
```

---

#### DELETE /v1/professionals/:id/block-ranges/:blockRangeId

Remove block range por ID.

**Resposta:** `204 No Content`

---

### 4.2 Agendamentos (scheduling)

#### GET /v1/scheduling

Lista appointments. Para médico: enviar `professionalId` e `from`/`to`.

**Query:**

| Campo          | Tipo   | Descrição                |
|----------------|--------|--------------------------|
| professionalId | uuid   | Filtra por profissional  |
| from           | YYYY-MM-DD | Início do período    |
| to             | YYYY-MM-DD | Fim do período       |
| status         | string | PENDING, CONFIRMED, etc  |
| page           | number | Paginação (default 1)    |
| limit          | number | Itens por página (default 20) |

**Exemplo:** `GET /v1/scheduling?professionalId=uuid&from=2025-03-01&to=2025-03-31`

**Resposta 200:**

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
      "contact": {
        "id": "uuid",
        "name": "Maria Silva",
        "phone": "+5511999999999"
      },
      "professional": {
        "id": "uuid",
        "fullName": "Dr. João"
      },
      "service": {
        "id": "uuid",
        "name": "Consulta",
        "durationMin": 50
      }
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "pages": 3
}
```

**Comportamento:** Se o usuário for PROFESSIONAL e não enviar `professionalId`, o backend usa o `professionalId` do membro e retorna só os appointments dele.

---

#### GET /v1/scheduling/:id

Detalhe de um appointment.

**Resposta 200:** objeto do appointment (com contact, professional, service).

---

#### GET /v1/scheduling/professionals/:id/availability

Slots livres em um dia (para criar novo appointment).

**Query:**

| Campo    | Tipo      | Obrigatório |
|----------|-----------|-------------|
| date     | YYYY-MM-DD| ✅          |
| serviceId| uuid      | ✅          |

**Exemplo:** `GET /v1/scheduling/professionals/uuid/availability?date=2025-03-15&serviceId=uuid`

**Resposta 200 (com slots):**

```json
{
  "slots": [
    {
      "time": "09:00",
      "endTime": "09:50",
      "scheduledAt": "2025-03-15T12:00:00.000Z"
    },
    {
      "time": "10:00",
      "endTime": "10:50",
      "scheduledAt": "2025-03-15T13:00:00.000Z"
    }
  ],
  "professional": {
    "id": "uuid",
    "fullName": "Dr. João"
  }
}
```

**Resposta 200 (sem slots / bloqueado):**

```json
{
  "slots": [],
  "reason": "Profissional indisponível nesta data"
}
```

ou

```json
{
  "slots": [],
  "reason": "Sem disponibilidade neste dia da semana"
}
```

---

#### POST /v1/scheduling

Cria appointment.

**Body:**

```json
{
  "contactId": "uuid",
  "professionalId": "uuid",
  "serviceId": "uuid",
  "scheduledAt": "2025-03-15T14:00:00.000Z",
  "durationMin": 50,
  "notes": "Opcional"
}
```

**Resposta 201:** objeto do appointment criado (com contact, professional, service).

---

#### PATCH /v1/scheduling/:id

Atualiza appointment.

**Body (parcial):**

```json
{
  "status": "CONFIRMED",
  "scheduledAt": "2025-03-15T15:00:00.000Z",
  "notes": "Alteração",
  "cancelledReason": "Motivo do cancelamento"
}
```

Status: `PENDING` | `CONFIRMED` | `CANCELLED` | `COMPLETED` | `NO_SHOW`.

**Resposta 200:** objeto atualizado.

---

#### DELETE /v1/scheduling/:id

Cancela appointment. **Resposta:** `204 No Content`.

---

## 5. Permissões

| Role        | Ver disponibilidade | Editar disponibilidade | Ver appointments | Editar appointments |
|-------------|---------------------|------------------------|------------------|----------------------|
| ADMIN       | ✅ Qualquer         | ✅ Qualquer            | ✅ Todos         | ✅ Todos             |
| PROFESSIONAL| ✅ Próprio          | ✅ Próprio             | ✅ Próprios      | conforme permissões  |
| SECRETARY   | ✅ Todos            | ❌                     | ✅ Todos         | ✅                   |

O profissional precisa estar vinculado ao membro (`member.professionalId`) para editar a própria disponibilidade.

---

## 6. Firestore (tempo real)

- **Caminho:** `tenants/{tenantId}/appointments/{appointmentId}`
- **Campos:** `id`, `contactId`, `professionalId`, `serviceId`, `scheduledAt`, `durationMin`, `status`, `notes`, `updatedAt`
- Use `onSnapshot` para atualizar o calendário quando appointments forem criados/alterados/cancelados (pela API ou pela IA).

---

## 7. Checklist de integração

1. [ ] `GET /v1/auth/me` para obter `professionalId` (ou admin escolhe profissional)
2. [ ] `GET /v1/professionals/:id` para carregar availability, exceptions, overrides, block-ranges
3. [ ] `GET /v1/scheduling?professionalId=...&from=...&to=...` para appointments do período
4. [ ] Implementar algoritmo de prioridade por dia (exceção → block range → override → grade semanal)
5. [ ] Renderizar blocos de disponibilidade e appointments no mesmo calendário
6. [ ] Implementar PUT/POST/DELETE para availability, exceptions, overrides, block-ranges
7. [ ] (Opcional) Firestore `onSnapshot` para atualização em tempo real
8. [ ] Legenda e toggle semana/mês
9. [ ] Detecção e destaque de appointments fora da disponibilidade
