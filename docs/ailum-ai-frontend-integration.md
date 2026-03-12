# Ailum AI — Guia de Integração Frontend

Documentação para integrar o chat Ailum AI no frontend, incluindo disponibilidade, consultas e fluxo de confirmação.

---

## Endpoints

Base: `POST /v1/ailum-ai` (prefixo da rota)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/availability` | Envia mensagem e recebe resposta (e possivelmente confirmação pendente) |
| POST | `/confirm` | Confirma uma ação que exige confirmação (cancelar/remarcar) |

---

## 1. POST /v1/ailum-ai/availability

### Request

```json
{
  "message": "minhas consultas de amanhã",
  "professionalId": "uuid",  // opcional se logado como profissional
  "messages": [              // opcional — histórico para chat
    { "role": "user", "content": "o que tenho hoje?" },
    { "role": "assistant", "content": "Você tem 3 consultas hoje..." }
  ]
}
```

### Response (200) — Resposta normal

```json
{
  "reply": "Você tem 3 consultas amanhã: 9h Maria, 11h João, 14h Ana.",
  "toolCalls": [
    {
      "name": "list_appointments",
      "input": { "from": "2025-03-13", "to": "2025-03-13" },
      "success": true,
      "message": "Encontradas 3 consulta(s)."
    }
  ]
}
```

### Response (200) — Ação exige confirmação

Quando a ação for **cancelar** ou **remarcar** consulta:

```json
{
  "reply": "Deseja mesmo cancelar a consulta de Maria em 15/03 às 14h?",
  "toolCalls": [...],
  "requiresConfirmation": true,
  "confirmationToken": "uuid-do-token",
  "confirmationSummary": "Cancelar consulta de Maria em 15/03/2025 às 14:00",
  "confirmationActionType": "cancel"
}
```

Campos de confirmação:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `requiresConfirmation` | boolean | Indica que precisa de confirmação do usuário |
| `confirmationToken` | string (UUID) | Token para enviar no POST /confirm |
| `confirmationSummary` | string | Texto amigável da ação (exibir na UI) |
| `confirmationActionType` | `"cancel"` \| `"reschedule"` | Tipo de ação |

---

## 2. POST /v1/ailum-ai/confirm

Chamado quando o usuário confirma a ação (ex.: clica em "Confirmar").

### Request

```json
{
  "confirmationToken": "uuid-retornado-no-availability",
  "professionalId": "uuid"   // opcional se logado como profissional
}
```

### Response (200) — Sucesso

```json
{
  "success": true,
  "message": "Consulta cancelada com sucesso."
}
```

### Response (200) — Erro (ex.: token expirado)

```json
{
  "success": false,
  "message": "Solicitação expirada. Por favor, tente novamente."
}
```

---

## Fluxo UX sugerido

### 1. Chat básico

1. Usuário envia mensagem.
2. Front chama `POST /availability` com `message` e `messages` (histórico).
3. Mostra `reply` na thread.
4. Guarda `{ role: 'assistant', content: reply }` no histórico e envia nas próximas chamadas.

### 2. Quando `requiresConfirmation === true`

1. Mostra a `reply` do assistente.
2. Exibe um bloco de confirmação, por exemplo:
   - Título: "Confirmar ação"
   - Texto: `confirmationSummary`
   - Botões: **"Confirmar"** e **"Cancelar"**
3. Ao clicar em **Confirmar**:
   - Chama `POST /confirm` com `confirmationToken`.
   - Se `success === true`: mostra toast/snackbar com `message` (ex: "Consulta cancelada com sucesso.") e atualiza a UI.
   - Se `success === false`: mostra `message` como erro (ex: "Solicitação expirada.").
4. Ao clicar em **Cancelar**: fecha o bloco de confirmação; não chama `/confirm`.

### 3. Textos por `confirmationActionType`

| `confirmationActionType` | Botão sugerido | Mensagem de sucesso típica |
|--------------------------|----------------|----------------------------|
| `cancel` | "Confirmar cancelamento" | "Consulta cancelada com sucesso." |
| `reschedule` | "Confirmar remarcação" | "Consulta remarcada com sucesso." |

---

## Exemplo de uso (fetch)

```typescript
// Enviar mensagem
const res = await fetch('/v1/ailum-ai/availability', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    message: 'cancelar a consulta das 14h com Maria',
    messages: chatHistory,
  }),
})
const data = await res.json()

// Exibir resposta
appendMessage('assistant', data.reply)

// Se exige confirmação, mostrar UI de confirmação
if (data.requiresConfirmation) {
  showConfirmDialog({
    summary: data.confirmationSummary,
    actionType: data.confirmationActionType,
    onConfirm: async () => {
      const confirmRes = await fetch('/v1/ailum-ai/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmationToken: data.confirmationToken }),
      })
      const confirmData = await confirmRes.json()
      if (confirmData.success) {
        toast.success(confirmData.message)
        closeConfirmDialog()
      } else {
        toast.error(confirmData.message)
      }
    },
  })
}
```

---

## Autenticação

- `onRequest: [fastify.authenticate]` — token JWT obrigatório.
- `professionalId` no body é opcional quando o usuário está logado como profissional.
- Admin pode enviar `professionalId` no body para agir em nome de outro profissional.

---

## O que o assistente faz

| Ação do usuário | Tool | Confirmação |
|-----------------|------|-------------|
| Ver consultas, agenda, o que tenho hoje/amanhã | `list_appointments` | Não |
| Alterar disponibilidade (bloquear, grade, etc.) | várias | Não |
| Cancelar / desmarcar consulta | `cancel_appointment` | Sim |
| Remarcar / reagendar consulta | `reschedule_appointment` | Sim |
