# Ailum AI — Disponibilidade por Linguagem Natural

> Endpoint: `POST /v1/ailum-ai/availability`  
> Base URL: `http://localhost:3001` (ou `NEXT_PUBLIC_API_URL`)  
> Auth: cookies de sessão (`credentials: 'include'`)

O usuário envia uma mensagem em linguagem natural e a IA interpreta e executa alterações na disponibilidade do profissional (grade semanal, bloqueios, overrides).

---

## Permissões

| Role        | Usar endpoint |
|-------------|---------------|
| ADMIN       | ✅ Qualquer profissional (passa `professionalId` no body) |
| PROFESSIONAL| ✅ Apenas o próprio (usa `professionalId` vinculado ao membro) |
| SECRETARY   | ❌ Sem acesso |

---

## Endpoint

### `POST /v1/ailum-ai/availability`

**Body:**

| Campo           | Tipo   | Obrigatório | Descrição |
|-----------------|--------|-------------|-----------|
| `message`       | string | Sim         | Instrução em linguagem natural (1–2000 caracteres) |
| `professionalId`| UUID   | Condicional | Obrigatório para ADMIN editando outro profissional. Omitir se PROFESSIONAL editando o próprio |

**Exemplo (profissional editando o próprio):**
```json
{
  "message": "Bloqueia amanhã e na próxima segunda"
}
```

**Exemplo (admin editando outro profissional):**
```json
{
  "message": "Férias de 01/04 a 15/04",
  "professionalId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

## Resposta

### 200 OK

```json
{
  "reply": "Bloqueado amanhã (11/03) e na segunda (17/03).",
  "toolCalls": [
    {
      "name": "block_day",
      "input": { "date": "2026-03-11" },
      "success": true,
      "message": "Dia 11/03/2026 bloqueado."
    },
    {
      "name": "block_day",
      "input": { "date": "2026-03-17" },
      "success": true,
      "message": "Dia 17/03/2026 bloqueado."
    }
  ]
}
```

| Campo        | Tipo     | Descrição |
|--------------|----------|-----------|
| `reply`      | string   | Resposta em texto para exibir ao usuário |
| `toolCalls`  | array    | Lista de alterações executadas |
| `toolCalls[].name`   | string | Nome da operação |
| `toolCalls[].input`  | object | Parâmetros usados |
| `toolCalls[].success`| boolean| Se a operação teve sucesso |
| `toolCalls[].message`| string | Mensagem de confirmação ou erro da operação |

---

## Erros

| Status | Situação |
|--------|----------|
| `400`  | `message` vazia ou inválida; `professionalId` ausente quando necessário |
| `401`  | Não autenticado |
| `403`  | Sem permissão (SECRETARY ou PROFESSIONAL tentando editar outro) |
| `429`  | Rate limit (20 requisições/minuto por IP) |

**Exemplo 400:**
```json
{
  "error": "professionalId obrigatório",
  "message": "Envie professionalId no body (ADMIN) ou faça login como profissional."
}
```

**Exemplo 403:**
```json
{
  "error": "Insufficient permissions",
  "required": "professionals:write or professionals:write_own (own profile only)"
}
```

---

## Exemplos de mensagens suportadas

| Intenção do usuário     | Exemplo de mensagem |
|-------------------------|---------------------|
| Bloquear um dia         | "Bloqueia amanhã", "Dia 25 não tenho", "Segunda não posso" |
| Bloquear intervalo      | "Férias de 01/04 a 15/04", "Próxima semana inteira bloqueada" |
| Definir grade semanal   | "Segunda a sexta 9h às 18h", "Terça e quinta 14h às 19h" |
| Horário em data específica | "Sábado 15/03 tenho 9h às 12h" |
| Bloqueio parcial        | "Segunda 11/03 só à tarde", "De manhã tenho reunião" |
| Remover bloqueio        | "Desbloqueia amanhã", "Remove o bloqueio de 01/04 a 15/04" |

---

## Integração no frontend

### React (fetch com credenciais)

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

async function sendAvailabilityMessage(
  message: string,
  professionalId?: string
): Promise<{ reply: string; toolCalls: Array<{ name: string; success: boolean; message: string }> }> {
  const res = await fetch(`${API_URL}/v1/ailum-ai/availability`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...(professionalId && { professionalId }) }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message ?? err.error ?? `Erro ${res.status}`)
  }

  return res.json()
}
```

### Uso em componente

```tsx
const [input, setInput] = useState('')
const [reply, setReply] = useState<string | null>(null)
const [loading, setLoading] = useState(false)

async function handleSubmit() {
  setLoading(true)
  setReply(null)
  try {
    const data = await sendAvailabilityMessage(input, professionalId)
    setReply(data.reply)
    // Opcional: invalidar cache de disponibilidade após sucesso
    // await refetchAvailability()
  } catch (e) {
    setReply(e instanceof Error ? e.message : 'Erro ao processar.')
  } finally {
    setLoading(false)
  }
}
```

---

## UX sugerida

1. **Campo de texto** — Área de digitação livre para a mensagem em linguagem natural.
2. **Exibir `reply`** — Mostrar a resposta da IA ao usuário (confirmação do que foi feito).
3. **Seleção de profissional** — Para ADMIN: dropdown para escolher qual profissional está editando. Para PROFESSIONAL: não mostrar (usa o próprio).
4. **Feedback visual** — Loading durante a chamada; erro em vermelho se falhar.
5. **Atualizar calendário** — Após sucesso, refazer `GET /v1/professionals/:id` ou invalidar cache para refletir as alterações no calendário.
6. **Placeholder** — Ex: "Ex: bloqueia amanhã, férias 01/04 a 15/04, segunda a sexta 9h às 18h"

---

## Rate limit

20 requisições por minuto por IP. Em caso de `429`, exibir mensagem orientando o usuário a aguardar alguns segundos.
