# Integração PIX — Guia para o Frontend

Documentação do fluxo PIX (Asaas + Z-API) e o que o frontend precisa implementar.

---

## Resumo

- **PIX obrigatório antes de confirmar** — flag configurável por stage
- **Envio automático** — QR code + código copia-e-cola via WhatsApp
- **Playground** — exibe PIX (QR + código) no chat para teste
- **Configuração Asaas** — API key Sandbox por tenant

---

## 1. Configurar Asaas (Sandbox)

### API do Backend

```http
PUT /v1/integrations/asaas
Content-Type: application/json
Authorization: Bearer <token>

{
  "apiKey": "$aact_MzkwODA..."
}
```

**Resposta 200**
```json
{
  "provider": "asaas",
  "instanceId": null,
  "webhookToken": null,
  "isActive": true,
  "hasApiKey": true
}
```

### Onde obter a chave Sandbox

1. Acesse https://sandbox.asaas.com
2. Crie conta ou faça login
3. Menu → Integrações → Chave da API
4. Copie a chave (começa com `$aact_`)

Em `NODE_ENV !== 'production'` o backend usa automaticamente `https://api-sandbox.asaas.com/v3`.

---

## 2. Stage: Exigir PIX antes de confirmar

A flag `requirePaymentBeforeConfirm` fica no **agent config do stage** (ex.: "Consulta Agendada").

### API

```http
PUT /v1/funnels/stages/:id/agent-config
Content-Type: application/json

{
  "requirePaymentBeforeConfirm": true,
  "allowedTools": ["search_availability", "create_appointment", "generate_pix", "move_stage", "send_message", "notify_operator"]
}
```

**Importante:** o stage deve ter `generate_pix` em `allowedTools` quando `requirePaymentBeforeConfirm` estiver ativo.

### Comportamento

| `requirePaymentBeforeConfirm` | Fluxo |
|------------------------------|-------|
| `false` (padrão)             | Agendamento pode ser confirmado sem PIX |
| `true`                       | Após `create_appointment`, o agente chama `generate_pix` com `appointment_id`. A consulta só fica confirmada após o pagamento |

---

## 3. Mensagens PIX no chat

Quando `generate_pix` roda com sucesso, o backend envia:

- **WhatsApp (contato real):** texto + imagem do QR + código copia-e-cola
- **Playground:** mensagem com `type: "PIX_CHARGE"` e `metadata` para renderizar o QR e o código

### Estrutura da mensagem PIX_CHARGE (Firestore)

```json
{
  "id": "uuid",
  "role": "AGENT",
  "type": "PIX_CHARGE",
  "content": "PIX R$ 150,00 - Consulta com Dr. João",
  "metadata": {
    "qrCodeUrl": "data:image/png;base64,iVBORw0KGgo...",
    "pixCopyPaste": "00020126580014br.gov.bcb.pix...",
    "amount": "150",
    "description": "Consulta com Dr. João"
  },
  "createdAt": "2026-03-12T14:30:00.000Z"
}
```

### Renderização no frontend

1. **type === "PIX_CHARGE"** — tratar como bloco PIX
2. **Imagem QR** — `metadata.qrCodeUrl` (data URL base64)
3. **Código copia-e-cola** — `metadata.pixCopyPaste` (texto longo)
4. **Ação** — botão "Copiar código" que copia `metadata.pixCopyPaste` para o clipboard

Exemplo (React):

```tsx
if (message.type === 'PIX_CHARGE' && message.metadata) {
  const { qrCodeUrl, pixCopyPaste, amount, description } = message.metadata
  return (
    <div className="pix-charge">
      <p>PIX R$ {amount} — {description}</p>
      {qrCodeUrl && <img src={qrCodeUrl} alt="QR Code PIX" width={200} />}
      {pixCopyPaste && (
        <>
          <p>Código PIX (copiar e colar):</p>
          <pre>{pixCopyPaste.slice(0, 50)}...</pre>
          <button onClick={() => navigator.clipboard.writeText(pixCopyPaste)}>
            Copiar código
          </button>
        </>
      )}
    </div>
  )
}
```

---

## 4. Playground

- O chat do playground lê mensagens do Firestore como no WhatsApp
- Em `testMode: true`, quando o agente gera PIX, o backend salva uma mensagem `type: "PIX_CHARGE"` com `metadata.qrCodeUrl` e `metadata.pixCopyPaste`
- O frontend deve exibir o QR code e o código copia-e-cola para o contato `__playground__`
- O contato é `phone: "__playground__"` — não envia nada para WhatsApp real
- `testMode: true` no `POST /v1/agent/message` garante modo playground

### Fluxo de teste

1. `GET /v1/agent/playground-contact` → obter `contactId`
2. `POST /v1/agent/message` com `{ contactId, message: "Quero agendar...", testMode: true }`
3. Ouvir Firestore `tenants/{tenantId}/contacts/{contactId}/messages` para novas mensagens
4. Quando chegar `type: "PIX_CHARGE"`, renderizar o bloco PIX no chat

---

## 5. Schema TypeScript (Firestore message)

```ts
interface ChatMessage {
  id: string
  role: 'CONTACT' | 'AGENT' | 'OPERATOR' | 'SYSTEM'
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'PIX_CHARGE'
  content: string
  metadata?: {
    qrCodeUrl?: string
    pixCopyPaste?: string
    amount?: string
    description?: string
  }
  createdAt: Date
}
```

---

## 6. Fluxo resumido

```
create_appointment (PENDING)
    ↓
generate_pix (com appointment_id, se requirePaymentBeforeConfirm)
    ↓
Backend envia PIX:
  - WhatsApp: texto + QR + código
  - Playground: Message PIX_CHARGE no Firestore
    ↓
Usuário paga
    ↓
Webhook Asaas PAYMENT_CONFIRMED
    ↓
Appointment → CONFIRMED
```

---

## 7. Checklist para o frontend

- [ ] Tela de Integrações: campo para API key Asaas + botão salvar (`PUT /v1/integrations/asaas`)
- [ ] Tela de Stages: toggle "Exigir pagamento PIX antes de confirmar" no agent config
- [ ] Chat: componente para `type: "PIX_CHARGE"` (QR + código + botão copiar)
- [ ] Playground: detectar `PIX_CHARGE` e exibir o mesmo componente de PIX
