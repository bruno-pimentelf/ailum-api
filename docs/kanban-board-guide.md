# Kanban Board — Guia de Integração Frontend

## Visão Geral

O kanban é alimentado por **dois fluxos paralelos**:

| Dado | Fonte | Como atualiza |
|---|---|---|
| Estrutura do board (funnel + stages) | `GET /v1/funnels/:id/board` | Fetch inicial + refetch manual |
| Estado dos cards em tempo real | Firestore `onSnapshot` | Automático (push) |

---

## 1. Carregar o Board

```
GET /v1/funnels/:funnelId/board
Authorization: Bearer <session_token>
```

**Query params opcionais:**
- `search` — filtra por nome ou telefone do contato
- `assignedProfessionalId` — filtra por profissional responsável (UUID)

**Resposta:**

```ts
interface BoardResponse {
  funnel: {
    id: string
    name: string
    description: string | null
  }
  stages: BoardStage[]
}

interface BoardStage {
  id: string
  name: string
  color: string       // hex, ex: "#3b82f6"
  order: number
  isTerminal: boolean // stage final (ganho/perdido)
  contacts: BoardContact[]
  _count: { contacts: number }
}

interface BoardContact {
  id: string
  phone: string
  name: string | null
  photoUrl: string | null       // URL Firebase Storage (permanente)
  status: ContactStatus         // "NEW_LEAD" | "ACTIVE" | "QUALIFIED" | ...
  stageEnteredAt: string | null // ISO datetime
  lastMessageAt: string | null  // ISO datetime
  lastPaymentStatus: string | null
  lastDetectedIntent: string | null
  currentStageId: string | null
  assignedProfessional: { id: string; fullName: string } | null
  messages: [{                  // última mensagem (array com 1 item ou vazio)
    content: string
    type: MessageType
    createdAt: string
    role: "CONTACT" | "OPERATOR" | "AGENT"
  }]
}
```

---

## 2. Mover Card entre Stages (Drag & Drop)

```
PATCH /v1/contacts/:contactId/stage
Authorization: Bearer <session_token>
Content-Type: application/json

{ "stageId": "uuid-do-stage-destino" }
```

- **200** → contato atualizado
- **404** → stage não encontrado ou não pertence ao tenant

O backend automaticamente atualiza `currentStageId`, `currentFunnelId` e `stageEnteredAt`, e dispara `syncContact` no Firestore. **Não use o retorno da API para atualizar a UI** — o `onSnapshot` já faz isso.

---

## 3. Atualizações em Tempo Real via Firestore

Após o fetch inicial, escute mudanças nos contatos do funnel ativo:

```ts
import { collection, onSnapshot, query, where } from 'firebase/firestore'

const contactsRef = collection(db, `tenants/${tenantId}/contacts`)
const q = query(contactsRef, where('funnelId', '==', funnelId))

const unsubscribe = onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    const contact = { id: change.doc.id, ...change.doc.data() }

    if (change.type === 'modified' || change.type === 'added') {
      // atualiza o card no stage correto: contact.stageId
      updateCardInBoard(contact)
    }
    if (change.type === 'removed') {
      removeCardFromBoard(contact.id)
    }
  })
})
```

**Campos do documento Firestore `contacts/{contactId}`** relevantes para o kanban:

```ts
interface FirestoreContact {
  id: string
  phone: string
  name: string | null
  photoUrl: string | null
  status: string
  stageId: string | null       // = currentStageId do Postgres
  funnelId: string | null      // = currentFunnelId do Postgres
  lastMessageAt: Timestamp | null
  assignedProfessionalId: string | null
  updatedAt: Timestamp
}
```

> `stageId` e `funnelId` no Firestore equivalem a `currentStageId` e `currentFunnelId` no Postgres e na resposta do board.

---

## 4. Listar Funnels Disponíveis

Para popular o seletor de funil no topo do kanban:

```
GET /v1/funnels
Authorization: Bearer <session_token>
```

Retorna todos os funnels ativos com seus stages (sem contatos). Use para montar o menu de navegação entre funnels.

---

## 5. Fluxo Completo Recomendado

```
1. GET /v1/funnels             → monta o seletor de funil
2. Usuário seleciona funil X
3. GET /v1/funnels/X/board     → renderiza o kanban inicial
4. onSnapshot contacts (funnelId == X) → mantém sincronizado
5. Drag & drop → PATCH /v1/contacts/:id/stage → onSnapshot atualiza UI
```

---

## 6. Filtros e Busca

Ao aplicar filtros no kanban, refaça o fetch com os query params:

```ts
// busca por nome/telefone
GET /v1/funnels/:id/board?search=ana

// filtrar por responsável
GET /v1/funnels/:id/board?assignedProfessionalId=uuid-do-profissional

// combinar
GET /v1/funnels/:id/board?search=joão&assignedProfessionalId=uuid
```

O `onSnapshot` não filtra por `assignedProfessionalId` — para esse caso, filtre localmente no estado já carregado ou refaça o fetch ao trocar o filtro.

---

## 7. Contagem por Stage

`_count.contacts` na resposta reflete o total real de contatos naquele stage (considerando filtros aplicados). Use para exibir o badge de quantidade no cabeçalho de cada coluna.

---

## Resumo dos Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/v1/funnels` | Lista funnels com stages |
| `GET` | `/v1/funnels/:id/board` | Board view com contatos por stage |
| `PATCH` | `/v1/contacts/:id/stage` | Move contato para outro stage |
| `PATCH` | `/v1/contacts/:id` | Atualiza dados do contato (nome, email, etc.) |
| `GET` | `/v1/contacts/:id` | Detalhes completos do contato |
