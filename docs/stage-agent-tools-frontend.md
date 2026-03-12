# Stage Agent Config — allowedTools (Integração Frontend)

As tools disponíveis para o agente de IA são configuradas por **stage** em `agentConfig.allowedTools`. O frontend precisa exibir e permitir editar essa lista.

---

## Recomendação UX: @ para referenciar tools nas instruções

Em vez de exigir que o usuário digite o nome da tool à mão (ex: `create_appointment`) nos campos "Tom e personalidade" e "Instruções do estágio", use **autocomplete com `@`**.

### Comportamento

1. Ao digitar `@` no textarea de instruções → abre um dropdown com as tools **habilitadas** em "Ferramentas permitidas".
2. Dropdown mostra **label amigável** e, opcionalmente, o `id` da tool entre parênteses.
3. Usuário seleciona (teclado ou clique) → insere o `id` da tool no texto (ex: `create_appointment`).
4. Evita typo e referência a tools desabilitadas.

### Exemplo de itens no dropdown

| id | Label sugerido |
|----|----------------|
| `search_availability` | Buscar horários |
| `create_appointment` | Agendar consulta |
| `cancel_appointment` | Cancelar consulta |
| `reschedule_appointment` | Remarcar consulta |
| `generate_pix` | Gerar cobrança PIX |
| `move_stage` | Mover entre etapas |
| `notify_operator` | Escalar para humano |
| `send_message` | Enviar mensagem |

Exemplo de exibição no menu: `Agendar consulta (create_appointment)` ou só `Agendar consulta`, inserindo `create_appointment` ao selecionar.

### Regra

- O dropdown só lista tools que estão **habilitadas** no stage atual. Assim o usuário não referencia algo que não estará disponível para o agente.

---

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/v1/funnels/stages/:stageId/agent-config` | Obtém config do agente (inclui allowedTools) |
| PUT | `/v1/funnels/stages/:stageId/agent-config` | Atualiza config (inclui allowedTools) |

Base: `/v1` | Auth: `credentials: 'include'`

---

## allowedTools — lista completa

| Tool | Descrição | Quando habilitar |
|------|-----------|------------------|
| `search_availability` | Busca horários disponíveis para agendamento | Stage de qualificação/agendamento |
| `create_appointment` | Cria consulta após confirmação do paciente | Stage de agendamento |
| `cancel_appointment` | Cancela consulta (solicitação do paciente) | Stage "Consulta Agendada" — permite cancelar |
| `reschedule_appointment` | Remarca consulta para nova data/horário | Stage "Consulta Agendada" — permite remarcar |
| `generate_pix` | Gera cobrança PIX | Stage de cobrança |
| `move_stage` | Move contato para outro stage do funil | Stages intermediários |
| `notify_operator` | Transfere para atendimento humano | Qualquer stage (recomendado manter) |
| `send_message` | Envia mensagem WhatsApp | Qualquer stage |

---

## Sugestão de UI

### Multi-select ou checkboxes + @ nas instruções

Use os mesmos labels nas checkboxes e no autocomplete `@`:

```ts
const TOOL_LABELS: Record<string, string> = {
  search_availability: 'Buscar horários',
  create_appointment: 'Agendar consulta',
  cancel_appointment: 'Cancelar consulta',
  reschedule_appointment: 'Remarcar consulta',
  generate_pix: 'Gerar cobrança PIX',
  move_stage: 'Mover entre etapas',
  notify_operator: 'Escalar para humano',
  send_message: 'Enviar mensagem',
}
```

### Exemplo de PUT

```json
{
  "allowedTools": ["search_availability", "create_appointment", "cancel_appointment", "reschedule_appointment", "move_stage", "send_message", "notify_operator"]
}
```

### Onde colocar cancel/remarca

- **Consulta Agendada**: stages que exibem consultas do contato — habilitar `cancel_appointment` e `reschedule_appointment` para a IA poder cancelar/remarcar quando o paciente pedir.
- **Novo Lead / Qualificado**: geralmente só `search_availability`, `create_appointment`, `move_stage`, `send_message`, `notify_operator`.

---

## Fluxo de confirmação

`cancel_appointment` e `reschedule_appointment` exigem **confirmação do operador** (igual a `create_appointment` e `generate_pix`). O backend retorna `requiresConfirmation: true` e a mensagem não é enviada ao contato até o operador confirmar na fila de pendentes.

---

## Obter config atual

O `GET /v1/funnels` (ou `GET /v1/funnels/:id/stages`) já retorna stages com `agentConfig`:

```json
{
  "stages": [
    {
      "id": "uuid",
      "name": "Consulta Agendada",
      "agentConfig": {
        "allowedTools": ["cancel_appointment", "reschedule_appointment", "send_message", "notify_operator"],
        ...
      }
    }
  ]
}
```

Para editar apenas as tools, fazer PUT com o body contendo `allowedTools` (e demais campos se quiser manter).

---

## Templates em triggers

Triggers com ação `SEND_MESSAGE` suportam `actionConfig.templateId` (ID do template) em vez de `actionConfig.message`. Se `templateId` for informado, o sistema usa o template (incluindo IMAGE, AUDIO, etc.). Caso contrário, usa `message` com variáveis `{{name}}`, `{{appointmentTime}}`.

Ver [message-templates.md](./message-templates.md) para API e variáveis disponíveis.
