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
GET    /v1/professionals                     → lista profissionais
GET    /v1/professionals/:id                 → detalhe (com availability + exceptions)
GET    /v1/professionals/:id/availability    → grade semanal (recorrente)
PUT    /v1/professionals/:id/availability    → define grade semanal (substitui tudo)
POST   /v1/professionals/:id/exceptions      → adiciona exceção (feriado/folga)
DELETE /v1/professionals/:id/exceptions/:date → remove exceção

GET    /v1/scheduling/professionals/:id/availability?date=&serviceId=  → slots livres em um dia
```

---

## GET /v1/professionals/:id

**Resposta** (inclui availability e exceptions):

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
    }
  ],
  "availabilityExceptions": [
    {
      "id": "uuid",
      "date": "2025-12-25",
      "isUnavailable": true,
      "reason": "Natal"
    }
  ]
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

| Campo           | Tipo   | Obrigatório | Descrição                    |
|-----------------|--------|-------------|------------------------------|
| dayOfWeek       | 0–6    | ✅          | Domingo=0, Segunda=1, …      |
| startTime       | "HH:mm"| ✅          | Ex: "09:00"                  |
| endTime         | "HH:mm"| ✅          | Ex: "18:00"                  |
| slotDurationMin | number | Não (50)    | Intervalo em minutos         |

**Resposta:** Array igual ao GET availability (grade atualizada).

---

## POST /v1/professionals/:id/exceptions

Adiciona exceção (dia indisponível ou bloqueio).

**Body:**

```json
{
  "date": "2025-12-25",
  "isUnavailable": true,
  "reason": "Natal"
}
```

| Campo          | Tipo    | Obrigatório | Descrição              |
|----------------|---------|-------------|------------------------|
| date           | YYYY-MM-DD | ✅       | Data                   |
| isUnavailable  | boolean | Não (true)  | true = folga           |
| reason         | string  | Não         | Ex: "Férias"           |

**Resposta 201:**

```json
{
  "id": "uuid",
  "professionalId": "uuid",
  "date": "2025-12-25T00:00:00.000Z",
  "isUnavailable": true,
  "reason": "Natal"
}
```

---

## DELETE /v1/professionals/:id/exceptions/:date

Remove exceção em uma data.

**Parâmetros:** `date` em formato `YYYY-MM-DD`.

**Resposta:** `204 No Content`.

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

## Fluxo sugerido no frontend

1. **Calendário / grade semanal**  
   - Admin: lista profissionais, escolhe um, edita disponibilidade.  
   - Profissional: vê apenas o próprio perfil (via `member.professionalId` ou GET /v1/professionals filtrado).

2. **GET /professionals/:id** para carregar perfil + availability + exceptions.

3. **PUT /professionals/:id/availability** ao salvar a grade semanal (substitui tudo).

4. **POST /professionals/:id/exceptions** ao adicionar folga/feriado.

5. **DELETE /professionals/:id/exceptions/:date** ao remover exceção.

6. **GET /scheduling/professionals/:id/availability** para mostrar slots ao agendar consulta.
