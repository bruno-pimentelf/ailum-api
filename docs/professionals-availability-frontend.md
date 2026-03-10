# Disponibilidade de Profissionais — Guia Frontend

Base: `/v1/professionals` | Auth: `Bearer <session_token>`

---

## Permissões

| Role        | Leitura | Editar disponibilidade              |
|------------|---------|-------------------------------------|
| ADMIN      | ✅ Todos | ✅ Qualquer profissional             |
| PROFESSIONAL | ✅ Todos | ✅ Apenas o próprio (linked)      |
| SECRETARY  | ✅ Todos | ❌ Nenhum                            |

O profissional precisa estar vinculado ao membro (`member.professionalId`) para editar a própria disponibilidade.

---

## Rotas

```
GET    /v1/professionals                           → lista profissionais
GET    /v1/professionals/:id                       → detalhe (availability + exceptions + overrides + blockRanges)
GET    /v1/professionals/:id/availability          → grade semanal (recorrente)
PUT    /v1/professionals/:id/availability          → define grade semanal (substitui tudo)
POST   /v1/professionals/:id/exceptions            → bloqueia um dia específico
DELETE /v1/professionals/:id/exceptions/:date      → remove exceção
POST   /v1/professionals/:id/overrides             → adiciona disponibilidade em data específica
GET    /v1/professionals/:id/overrides?from=&to=   → lista overrides (opcional filtro por período)
DELETE /v1/professionals/:id/overrides/:overrideId → remove override
POST   /v1/professionals/:id/block-ranges          → bloqueia intervalo de datas (ex: férias)
GET    /v1/professionals/:id/block-ranges          → lista blocos de datas bloqueadas
DELETE /v1/professionals/:id/block-ranges/:id      → remove block range

GET    /v1/scheduling/professionals/:id/availability?date=&serviceId=  → slots livres em um dia
```

**Regras de prioridade (data X):**
1. Se há **exceção com isUnavailable=true** (dia inteiro bloqueado) → indisponível
2. Se data está em algum **block range** → indisponível
3. Se há **override** para a data → usa horários do override (sobrescreve grade semanal)
4. Caso contrário → usa **grade semanal** pelo dayOfWeek
5. **slotMask**: exceções com isUnavailable=false e slotMask removem apenas essas janelas da grade semanal (bloqueio parcial)

---

## GET /v1/professionals/:id

**Resposta** (inclui availability, exceptions, overrides, blockRanges):

```json
{
  "id": "uuid",
  "fullName": "Dr. João",
  "availability": [ { "dayOfWeek": 1, "startTime": "09:00", "endTime": "18:00", "slotDurationMin": 50 } ],
  "availabilityExceptions": [ { "date": "2025-12-25", "isUnavailable": true, "reason": "Natal" } ],
  "availabilityOverrides": [ { "date": "2025-03-15", "startTime": "09:00", "endTime": "12:00", "slotDurationMin": 50 } ],
  "availabilityBlockRanges": [ { "id": "uuid", "dateFrom": "2025-04-01", "dateTo": "2025-04-15", "reason": "Férias" } ]
}
```

**dayOfWeek**: 0 = Domingo, 1 = Segunda, …, 6 = Sábado.

---

## GET /v1/professionals/:id/availability

Retorna só a grade recorrente (sem exceções).

**Resposta:**

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

## PUT /v1/professionals/:id/availability

Define a grade semanal. Substitui todas as faixas existentes. Enviar array vazio remove tudo.

**Permissão**: ADMIN (qualquer profissional) ou PROFESSIONAL (apenas o próprio).

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
| startTime       | "HH:mm"| ✅          | Em incrementos de 5 min: 00, 05, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55   |
| endTime         | "HH:mm"| ✅          | Idem                                                                      |
| slotDurationMin | number | Não (50)    | Duração de cada slot em min (5–120). Ex: 5, 10, 30, 50                    |

**Resposta:** Array igual ao GET availability (grade atualizada).

---

## POST /v1/professionals/:id/exceptions

Adiciona exceção: **bloqueio total** (dia inteiro) ou **bloqueio parcial** (slotMask).

**Bloqueio total (dia inteiro):**

```json
{
  "date": "2025-12-25",
  "isUnavailable": true,
  "reason": "Natal"
}
```

**Bloqueio parcial (remover horários específicos da grade semanal):**  
Use `isUnavailable: false` e `slotMask` com as janelas a remover.

```json
{
  "date": "2025-03-11",
  "isUnavailable": false,
  "slotMask": [
    { "startTime": "09:00", "endTime": "12:00" }
  ]
}
```

Ex: Segunda 11/03 normalmente 9h–18h, mas bloquear só 9h–12h (reunião). O dia continua disponível 12h–18h.

| Campo          | Tipo    | Obrigatório | Descrição                                                                 |
|----------------|---------|-------------|---------------------------------------------------------------------------|
| date           | YYYY-MM-DD | ✅       | Data                                                                      |
| isUnavailable  | boolean | Não (true)  | true = dia inteiro bloqueado; false = usar slotMask para bloqueios parciais |
| reason         | string  | Não         | Ex: "Férias"                                                              |
| slotMask       | array   | Não         | Só quando isUnavailable=false. Janelas a remover: `[{ startTime, endTime }]` |

**Resposta 201:**

```json
{
  "id": "uuid",
  "professionalId": "uuid",
  "date": "2025-12-25T00:00:00.000Z",
  "isUnavailable": true,
  "reason": "Natal",
  "slotMask": null
}
```

Com slotMask:

```json
{
  "id": "uuid",
  "date": "2025-03-11T00:00:00.000Z",
  "isUnavailable": false,
  "reason": null,
  "slotMask": [{ "startTime": "09:00", "endTime": "12:00" }]
}
```

---

## DELETE /v1/professionals/:id/exceptions/:date

Remove exceção em uma data.

**Parâmetros:** `date` em formato `YYYY-MM-DD`.

**Resposta:** `204 No Content`.

---

## POST /v1/professionals/:id/overrides

Adiciona disponibilidade em uma **data específica** (sobrescreve a grade semanal nesse dia).  
Ex: "Sábado 15/03 tenho 09:00–12:00" mesmo sem sábado na grade.

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
| startTime       | HH:mm  | ✅          | Incrementos de 5 min (00, 05, …)  |
| endTime         | HH:mm  | ✅          | Idem                              |
| slotDurationMin | number | Não (50)    | Duração do slot em minutos        |

**Resposta 201:** Objeto do override criado.

---

## GET /v1/professionals/:id/overrides

Lista overrides. Query opcional: `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

---

## DELETE /v1/professionals/:id/overrides/:overrideId

Remove override por ID.

---

## POST /v1/professionals/:id/block-ranges

Bloqueia um **intervalo de datas** (ex: férias, licença).

**Body:**

```json
{
  "dateFrom": "2025-04-01",
  "dateTo": "2025-04-15",
  "reason": "Férias"
}
```

| Campo   | Tipo   | Obrigatório | Descrição       |
|---------|--------|-------------|-----------------|
| dateFrom| YYYY-MM-DD | ✅     | Início          |
| dateTo  | YYYY-MM-DD | ✅     | Fim (≥ dateFrom)|
| reason  | string | Não         | Ex: "Férias"    |

**Resposta 201:** Objeto do block range criado.

---

## GET /v1/professionals/:id/block-ranges

Lista blocos de datas bloqueadas.

---

## DELETE /v1/professionals/:id/block-ranges/:blockRangeId

Remove block range por ID.

---

## GET /v1/scheduling/professionals/:id/availability

Retorna slots disponíveis em um dia específico (para agendamento).

**Query:**

| Campo    | Tipo | Obrigatório |
|----------|------|-------------|
| date     | YYYY-MM-DD | ✅      |
| serviceId| uuid | ✅          |

**Exemplo:**  
`GET /v1/scheduling/professionals/xxx/availability?date=2025-03-15&serviceId=yyy`

**Resposta:**

```json
{
  "slots": [
    {
      "time": "09:00",
      "endTime": "09:50",
      "scheduledAt": "2025-03-15T12:00:00.000Z"
    }
  ],
  "professional": {
    "id": "uuid",
    "fullName": "Dr. João"
  }
}
```

Se houver exceção ou sem disponibilidade no dia:

```json
{
  "slots": [],
  "reason": "Profissional indisponível nesta data"
}
```

ou `"reason": "Sem disponibilidade neste dia da semana"`.

---

## Fluxo sugerido no frontend (UX)

1. **Grade semanal (recorrência)**  
   - Toda segunda 9h–18h, toda quarta 14h–20h etc.  
   - PUT `/availability` — substitui tudo.

2. **Dia específico bloqueado**  
   - Ex: 25/12, 1º de janeiro.  
   - POST `/exceptions` + DELETE `/exceptions/:date`.

3. **Intervalo bloqueado**  
   - Ex: férias 01/04–15/04.  
   - POST `/block-ranges` + DELETE `/block-ranges/:id`.

4. **Disponibilidade em data específica**  
   - Ex: sábado 15/03 9h–12h (fora da grade semanal).  
   - POST `/overrides` + DELETE `/overrides/:id`.

5. **"Toda segunda não posso"**  
   - Não incluir segunda na grade semanal (ou remover o bloco de segunda).

**Sugestão de UX: calendário visual**
- Ver mês, clicar em dia: bloquear, desbloquear ou adicionar horários específicos.
- Intervalos: selecionar data inicial e final para bloqueio em massa.
- Horários em incrementos de 5 min (09:00, 09:05, 09:10…).
