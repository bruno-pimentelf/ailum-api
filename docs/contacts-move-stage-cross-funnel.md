# Mover contato entre funis — integração frontend

O endpoint `PATCH /v1/contacts/:id/stage` já suporta mover o contato para um stage de qualquer funil do tenant. `currentStageId` e `currentFunnelId` são atualizados com base no stage escolhido.

---

## Endpoint

```http
PATCH /v1/contacts/:contactId/stage
Authorization: Bearer <session_token>
Content-Type: application/json
```

**Body:**
```json
{
  "stageId": "uuid"
}
```

**Body (opcional, validação explícita):**
```json
{
  "stageId": "uuid",
  "funnelId": "uuid"
}
```

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `stageId` | sim | UUID do stage de destino (pode ser de qualquer funil) |
| `funnelId` | não | Se enviado, valida que o stage pertence a esse funil. Retorna 400 se não pertencer. |

**Response 200** — contato atualizado (inclui `currentStageId`, `currentFunnelId`)

**Errors:**
- 404 — stage não existe ou não pertence ao tenant
- 400 — `funnelId` enviado mas stage pertence a outro funil

---

## Integração no frontend

### 1. Buscar funis e stages

Para montar o seletor de destino (funil + stage), use:

```http
GET /v1/funnels
Authorization: Bearer <token>
```

Retorno: lista de funis, cada um com `stages[]`:

```ts
Funnel[] = [
  { id, name, description, stages: [{ id, name, color, order }, ...] },
  ...
]
```

### 2. UI sugerida

- **Modal "Mover contato"**: dropdown/select hierárquico
  - Primeiro nível: funil (ex.: "Funil Principal", "Funil Vendas")
  - Segundo nível: stage (ex.: "Novo Lead", "Qualificado")
- Ao selecionar o stage, chame:

```ts
await api.patch(`/v1/contacts/${contactId}/stage`, {
  stageId: selectedStageId,
  funnelId: selectedFunnelId,  // opcional, recomendado para validar
})
```

### 3. Fluxo mínimo

1. Abrir modal ao arrastar card ou clicar em "Mover" no contato
2. Carregar `GET /v1/funnels` (ou reusar dados já em cache)
3. Exibir lista: para cada funil, listar seus stages
4. Usuário escolhe um stage
5. `PATCH /v1/contacts/:id/stage` com `{ stageId }` (e opcionalmente `funnelId`)
6. Atualizar estado local ou esperar o Firestore `onSnapshot` refletir a mudança

### 4. Nota

O kanban usa Firestore em tempo real. Após o `PATCH`, o Firestore recebe o `syncContact` e o board deve atualizar automaticamente. O card muda de coluna conforme o novo `currentStageId` / `currentFunnelId`. Se o board atual mostra apenas um funil, o card sai da view (ou é necessário suportar visualização multi-funil).
