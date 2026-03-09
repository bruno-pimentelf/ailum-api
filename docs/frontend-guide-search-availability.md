# Guia Frontend — search_availability

## O que mudou

O agente agora chama a tool `search_availability` quando o usuário indica um dia (ex: "amanhã", "terça") para buscar horários reais. Isso corrige o agendamento para dias que não são hoje.

**Fluxo:**
1. Usuário: "Quero marcar consulta"
2. Agente: "Qual dia?"
3. Usuário: "Amanhã de manhã"
4. Agente chama `search_availability` internamente → recebe profissionais, IDs e horários
5. Agente oferece horários e, ao confirmar, chama `create_appointment` com os IDs corretos

---

## O front precisa implementar algo?

**Pouco.** A maior parte é transparente (chat continua igual).

### 1. Stage Config — allowedTools (se tiver tela de config)

Se existe tela de "Configurar IA" do stage com checkboxes de ferramentas, adicione:

| Label | Valor |
|-------|-------|
| Buscar disponibilidade por data | `search_availability` |

- Ao **criar** config de stage: incluir `search_availability` em `allowedTools` junto com `create_appointment` (recomendado para fluxo de agendamento).
- Ao **editar**: permitir marcar/desmarcar `search_availability`.
- Stages já existentes já receberam `search_availability` via migração no backend.

**PUT /v1/funnels/stages/:stageId/agent-config**
```json
{
  "allowedTools": ["search_availability", "create_appointment", "move_stage", "send_message", "notify_operator"]
}
```

### 2. Chat / Playground

Nenhuma alteração. O agente usa a tool automaticamente. O front continua enviando mensagens e mostrando respostas.

### 3. Audit (opcional)

Se houver tela de audit que lista tools chamadas, pode aparecer `search_availability` além de `create_appointment`, `move_stage`, etc. Pode ser tratada como qualquer outra tool.

---

## Resumo

| Área | Ação |
|------|------|
| Stage Config | Incluir `search_availability` nas opções de allowedTools e no PUT |
| Chat | Nenhuma mudança |
| Audit | Opcional: exibir `search_availability` na lista de tools |
