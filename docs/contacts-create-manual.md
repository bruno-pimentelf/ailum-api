# POST Contato (manual)

```
POST /v1/contacts
Authorization: Bearer <token>
Content-Type: application/json
```

## Body

```json
{
  "phone": "string",           // obrigatório, min 8 chars
  "name": "string",
  "email": "string",
  "notes": "string",
  "funnelId": "uuid",          // coloca no funil
  "stageId": "uuid",           // coloca no stage (stage deve pertencer ao funnelId)
  "assignedProfessionalId": "uuid"
}
```

- **phone** — obrigatório. Se já existir (tenant + phone), retorna 400.
- **funnelId** e **stageId** — opcionais. Se enviar, o contato entra direto no funil/board.

## Response 201

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "phone": "string",
  "name": "string | null",
  "email": "string | null",
  "notes": "string | null",
  "currentFunnelId": "uuid | null",
  "currentStageId": "uuid | null",
  "status": "NEW_LEAD",
  "stageEnteredAt": "ISO8601 | null",
  "lastMessageAt": null,
  "assignedProfessionalId": "uuid | null",
  "isActive": true,
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

## Instruções

1. Use `phone` com DDI (ex: `5511999999999`).
2. Para colocar no kanban, envie `funnelId` e `stageId` do stage de destino.
3. `stageId` deve ser de um stage do mesmo funil indicado em `funnelId`.
4. Se não enviar funnel/stage, o contato fica "sem funil" até ser movido via `PATCH /v1/contacts/:id/stage`.
