# Profissionais e Serviços — Listar e Associar (Guia Frontend)

Este guia cobre como listar profissionais, listar serviços, e **associar cada serviço aos profissionais** que o oferecem. A associação é obrigatória para o agendamento via IA e para a busca de disponibilidade.

**Base:** `GET/POST/DELETE` em `/v1/professionals` e `/v1/services`  
**Auth:** `Authorization: Bearer <session_token>` em todas as rotas.

---

## 1. Conceito e UX

- **Serviço** = tipo de atendimento (ex: Consulta inicial, Retorno, Avaliação). Pertence ao tenant.
- **Profissional** = quem atende (ex: Dr. João, Dra. Maria). Tem disponibilidade semanal e exceções.
- **Vínculo** = qual profissional oferece qual serviço. Um serviço pode ser oferecido por vários profissionais; um profissional pode oferecer vários serviços.

Sem vínculo, o profissional **não aparece** na busca de horários do agente de IA nem no agendamento.

### 1.1 Fluxos de UX recomendados

**Opção A — Por serviço (tela de Serviço)**  
1. Usuário cria ou edita um serviço (ex: "Consulta inicial").  
2. Na mesma tela ou em aba "Profissionais que oferecem": lista de profissionais com checkbox (ou multi-select).  
3. Ao salvar: para cada profissional marcado, chamar `POST /v1/professionals/:id/services/:serviceId`. Para cada desmarcado que estava antes vinculado, chamar `DELETE /v1/professionals/:id/services/:serviceId`.  
4. Carregar profissionais já vinculados com `GET /v1/services/:id` (resposta traz `professionalServices[].professional`).

**Opção B — Por profissional (tela de Profissional)**  
1. Usuário edita um profissional (ex: Dr. João).  
2. Seção "Serviços que este profissional oferece": lista de serviços com checkbox (ou multi-select).  
3. Ao salvar: para cada serviço marcado, `POST /v1/professionals/:professionalId/services/:serviceId`; para cada desmarcado que estava vinculado, `DELETE /v1/professionals/:professionalId/services/:serviceId`.  
4. Carregar serviços já vinculados com `GET /v1/professionals/:id` (resposta traz `professionalServices[].service`).

**Opção C — Tela dedicada "Quem oferece o quê"**  
- Lista de serviços; ao clicar em um serviço, abre modal ou painel com lista de profissionais e checkboxes.  
- Persistir via POST/DELETE como acima.

---

## 2. Rotas necessárias (resumo)

| Ação | Método | Rota |
|------|--------|------|
| Listar profissionais (com serviços vinculados) | GET | `/v1/professionals` |
| Detalhe do profissional (com serviços + disponibilidade) | GET | `/v1/professionals/:id` |
| Listar serviços | GET | `/v1/services` |
| Detalhe do serviço (com profissionais vinculados) | GET | `/v1/services/:id` |
| Vincular profissional a serviço | POST | `/v1/professionals/:id/services/:serviceId` |
| Desvincular profissional de serviço | DELETE | `/v1/professionals/:id/services/:serviceId` |

---

## 3. GET /v1/professionals — Listar profissionais

Lista todos os profissionais ativos do tenant, **com os serviços já vinculados**.

**Request**

- Headers: `Authorization: Bearer <token>`
- Body: nenhum

**Response 200**

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "tenantId": "tenant-uuid",
    "fullName": "Dr. João Silva",
    "specialty": "Fisioterapia",
    "bio": null,
    "avatarUrl": null,
    "voiceId": null,
    "calendarColor": "#3b82f6",
    "isActive": true,
    "voice": null,
    "professionalServices": [
      {
        "professionalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "serviceId": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
        "customPrice": null,
        "service": {
          "id": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
          "name": "Consulta inicial",
          "price": 250
        }
      },
      {
        "professionalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "serviceId": "s2s2s2s2-s2s2-s2s2-s2s2-s2s2s2s2s2s2",
        "customPrice": 200,
        "service": {
          "id": "s2s2s2s2-s2s2-s2s2-s2s2-s2s2s2s2s2s2",
          "name": "Retorno",
          "price": 150
        }
      }
    ]
  }
]
```

Use `professionalServices[].service.id` e `professionalServices[].service.name` para exibir “serviços deste profissional” e para saber quais já estão vinculados.

---

## 4. GET /v1/professionals/:id — Detalhe do profissional

Retorna um profissional com **serviços vinculados**, disponibilidade semanal e exceções. Ideal para tela de edição do profissional (e para montar o multi-select de serviços).

**Request**

- Params: `id` (UUID do profissional)
- Headers: `Authorization: Bearer <token>`

**Response 200**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "tenantId": "tenant-uuid",
  "fullName": "Dr. João Silva",
  "specialty": "Fisioterapia",
  "bio": null,
  "avatarUrl": null,
  "voiceId": null,
  "calendarColor": "#3b82f6",
  "isActive": true,
  "voice": null,
  "professionalServices": [
    {
      "professionalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "serviceId": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
      "customPrice": null,
      "service": {
        "id": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
        "name": "Consulta inicial",
        "description": null,
        "durationMin": 50,
        "price": 250,
        "isActive": true,
        "isConsultation": true,
        "tenantId": "tenant-uuid",
        "createdAt": "2026-01-01T00:00:00.000Z"
      }
    }
  ],
  "availability": [
    {
      "id": "avail-uuid",
      "professionalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "dayOfWeek": 1,
      "startTime": "09:00",
      "endTime": "18:00",
      "slotDurationMin": 50
    }
  ],
  "availabilityExceptions": []
}
```

`dayOfWeek`: 0 = domingo, 1 = segunda, …, 6 = sábado.

---

## 5. GET /v1/services — Listar serviços

Lista serviços ativos. Use para popular listas e multi-selects ao associar “quem oferece este serviço” ou “quais serviços este profissional oferece”.

**Request**

- Headers: `Authorization: Bearer <token>`

**Response 200**

```json
[
  {
    "id": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
    "tenantId": "tenant-uuid",
    "name": "Consulta inicial",
    "description": null,
    "durationMin": 50,
    "price": 250,
    "isActive": true,
    "isConsultation": true,
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
]
```

---

## 6. GET /v1/services/:id — Detalhe do serviço (com profissionais vinculados)

Retorna o serviço e **quais profissionais já o oferecem**. Ideal para tela de edição do serviço (multi-select de profissionais).

**Request**

- Params: `id` (UUID do serviço)
- Headers: `Authorization: Bearer <token>`

**Response 200**

```json
{
  "id": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
  "tenantId": "tenant-uuid",
  "name": "Consulta inicial",
  "description": null,
  "durationMin": 50,
  "price": 250,
  "isActive": true,
  "isConsultation": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "professionalServices": [
    {
      "professionalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "serviceId": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
      "customPrice": null,
      "professional": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "fullName": "Dr. João Silva",
        "isActive": true
      }
    }
  ]
}
```

Use `professionalServices[].professional.id` (e `fullName`) para marcar no UI quais profissionais já estão vinculados a este serviço.

---

## 7. POST /v1/professionals/:id/services/:serviceId — Vincular profissional a serviço

Associa um profissional a um serviço. Necessário para o profissional aparecer na busca de disponibilidade e no agendamento para esse serviço.

**Request**

- Params:
  - `id` — UUID do **profissional**
  - `serviceId` — UUID do **serviço**
- Headers: `Authorization: Bearer <token>`
- Body (JSON, opcional):

```json
{
  "customPrice": 200
}
```

| Campo         | Tipo   | Obrigatório | Descrição                                      |
|---------------|--------|-------------|------------------------------------------------|
| customPrice   | number | Não         | Preço específico deste profissional para este serviço; se omitido, usa o preço do serviço |

**Response 201**

```json
{
  "professionalId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "serviceId": "s1s1s1s1-s1s1-s1s1-s1s1-s1s1s1s1s1s1",
  "customPrice": null
}
```

**Erros**

- `404`: Profissional ou serviço não encontrado (ou de outro tenant).
- `403`: Sem permissão (ex.: SECRETARY não pode alterar vínculos).

---

## 8. DELETE /v1/professionals/:id/services/:serviceId — Desvincular

Remove a associação entre profissional e serviço.

**Request**

- Params: `id` (UUID do profissional), `serviceId` (UUID do serviço)
- Headers: `Authorization: Bearer <token>`
- Body: nenhum

**Response 200**

Corpo vazio ou objeto mínimo. O vínculo deixa de existir.

**Erros**

- `404`: Profissional ou vínculo não encontrado.

---

## 9. Persistência em lote (UX “salvar associações”)

Ao salvar a tela (por serviço ou por profissional), o back **não** tem um endpoint único “salvar todos os vínculos”. O front deve:

1. Carregar o estado atual: `GET /v1/services/:id` ou `GET /v1/professionals/:id`.
2. Comparar com o estado desejado (checkboxes).
3. Para cada vínculo **novo** (marcado e que não estava):  
   `POST /v1/professionals/:professionalId/services/:serviceId`.
4. Para cada vínculo **removido** (desmarcado e que estava):  
   `DELETE /v1/professionals/:professionalId/services/:serviceId`.

Não é necessário enviar nada para vínculos que não mudaram. Opcional: enviar requisições em paralelo (Promise.all), respeitando rate limit do backend.

---

## 10. Permissões

| Role         | Listar profissionais/serviços | Associar/desassociar profissional ↔ serviço |
|--------------|-------------------------------|---------------------------------------------|
| ADMIN        | Sim                           | Sim                                         |
| SECRETARY    | Sim                           | Não                                         |
| PROFESSIONAL | Sim (todos)                   | Não (apenas ADMIN altera vínculos)          |

Todas as rotas desta página exigem autenticação; associação exige `PERMISSIONS.PROFESSIONALS_WRITE` (ADMIN).

---

## 11. Resumo rápido (Body + Response)

| Rota | Body | Response |
|------|------|----------|
| `GET /v1/professionals` | — | Array de profissionais com `professionalServices[].service` |
| `GET /v1/professionals/:id` | — | Um profissional com `professionalServices`, `availability`, `availabilityExceptions` |
| `GET /v1/services` | — | Array de serviços |
| `GET /v1/services/:id` | — | Um serviço com `professionalServices[].professional` |
| `POST /v1/professionals/:id/services/:serviceId` | `{ "customPrice": number? }` | `201` + `{ professionalId, serviceId, customPrice }` |
| `DELETE /v1/professionals/:id/services/:serviceId` | — | `200` |
