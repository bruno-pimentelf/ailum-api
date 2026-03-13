# Integração Slot Recall — Lista de Espera ao Cancelar

Documentação da funcionalidade de recall: avisar contatos que pediram "me coloca no lugar se abrir vaga" quando um horário é cancelado.

---

## Resumo

- **Memória** — O agente grava `wants_slot_on_cancellation` (e opcionalmente `preferred_professional`, `preferred_weekday`, etc.) quando o contato pede para ser avisado
- **Trigger** — Ao cancelar um agendamento via `cancel_appointment` (tool do agente), o job de recall é enfileirado
- **Worker** — Busca memórias compatíveis, filtra por profissional preferido e status (exclui `ATTENDED`), envia mensagem via WhatsApp
- **Configuração** — Flag `isSlotRecallEnabled` no tenant (igual ao `isAgentEnabledForWhatsApp`)

---

## 1. API do Tenant

### GET /v1/tenant

Retorna `isSlotRecallEnabled`:

```json
{
  "id": "uuid",
  "name": "Clínica",
  "isAgentEnabledForWhatsApp": false,
  "isSlotRecallEnabled": false,
  ...
}
```

### PATCH /v1/tenant

Para habilitar ou desabilitar o recall:

```http
PATCH /v1/tenant
Authorization: Bearer <token>
Content-Type: application/json

{
  "isSlotRecallEnabled": true
}
```

Requer role **ADMIN**.

---

## 2. Frontend — Configurações

Adicionar um toggle em **Configurações do Tenant** (ao lado do toggle de IA no WhatsApp):

- **Label:** "Avisar lista de espera ao cancelar" ou "Recall de vagas"
- **Descrição:** "Quando alguém cancelar um agendamento, contatos que pediram para ser avisados serão notificados por WhatsApp"
- **Campo:** `isSlotRecallEnabled`
- **PUT:** `PATCH /v1/tenant` com `{ "isSlotRecallEnabled": true | false }`

---

## 3. Fluxo Técnico

1. **Conversa** — Contato diz "se abrir vaga me coloca", "me avisa se alguém cancelar", etc.
2. **Memory service** — Extrai e salva `wants_slot_on_cancellation` (e `preferred_professional` se mencionar o nome)
3. **Cancelamento** — `cancel_appointment` é chamado (pelo agente)
4. **Enfileiramento** — Se `tenant.isSlotRecallEnabled`, job `slot-recall` é adicionado com: `tenantId`, `professionalId`, `professionalName`, `scheduledAt`, `serviceName`, `excludeContactId`
5. **Worker** — Busca memórias `wants_slot_on_cancellation`; exclui `ATTENDED`; filtra por `preferred_professional`; envia mensagem via Z-API

---

## 4. Mensagem Enviada

Exemplo:

> Olá, Maria! Abriu uma vaga com Dr. João no dia 15/03 às 14h (consulta). Quer agendar? É só responder aqui que te ajudo!

---

## 5. Filtros Aplicados

| Condição                    | Comportamento                          |
|----------------------------|----------------------------------------|
| `status = ATTENDED`        | Não envia (já foi atendido)            |
| `phone = '__playground__'` | Não envia (contato de teste)           |
| `preferred_professional`   | Se houver memória, só envia se bater com o profissional do slot |
| `excludeContactId`         | Não envia para quem cancelou           |

---

## 6. Migrations

Rodar para aplicar o campo `isSlotRecallEnabled` na tabela `tenants`:

```bash
npx prisma migrate deploy
```

Migration: `20260313000000_add_is_slot_recall_enabled`
