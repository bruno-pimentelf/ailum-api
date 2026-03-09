# Firestore — Schema Completo e Guia de Integração Frontend

> Fonte da verdade: `src/services/firebase-sync.service.ts` e `src/services/contact-photo.service.ts`
> Toda a UI de conversas é alimentada exclusivamente por `onSnapshot`. Zero GETs para o backend da Ailum nessa tela.

---

## Estrutura de coleções

```
tenants/{tenantId}                          ← doc do tenant (status do WhatsApp)
tenants/{tenantId}/contacts/{contactId}     ← doc do contato (lista de chats)
tenants/{tenantId}/contacts/{contactId}/
  messages/{messageId}                      ← mensagens da conversa
tenants/{tenantId}/appointments/{id}        ← agendamentos
tenants/{tenantId}/charges/{id}             ← cobranças
```

---

## `tenants/{tenantId}` — Status da instância WhatsApp

Escrito por: `syncInstanceStatus`

```ts
interface FirestoreTenant {
  whatsappConnected: boolean        // true = instância conectada ao WhatsApp
  whatsappError?: string            // mensagem de erro quando desconectado
  whatsappStatusAt: Timestamp       // última vez que o status mudou
  updatedAt: Timestamp
}
```

**Quando atualiza:**
- Webhook `ConnectedCallback` → `whatsappConnected: true`
- Webhook `DisconnectedCallback` → `whatsappConnected: false, whatsappError: "..."`
- `PUT /v1/integrations/zapi` → inicializa com o status real consultado na Z-API

**Como usar no frontend:**

```ts
import { doc, onSnapshot } from 'firebase/firestore'

const tenantRef = doc(db, 'tenants', tenantId)

onSnapshot(tenantRef, (snap) => {
  const data = snap.data() as FirestoreTenant | undefined
  setWhatsappConnected(data?.whatsappConnected ?? false)
  setWhatsappError(data?.whatsappError ?? null)
})
```

---

## `tenants/{tenantId}/contacts/{contactId}` — Lista de chats

Este documento tem **dois grupos de campos** que são escritos por funções diferentes.

### Grupo 1 — Preview da conversa

Escrito por: `syncConversationMessage` (a cada mensagem enviada ou recebida)

```ts
// Campos escritos a cada mensagem
lastMessage: string           // primeiros 100 chars da última mensagem
lastMessageAt: Timestamp      // data/hora da última mensagem
updatedAt: Timestamp          // serverTimestamp()
unreadCount: number           // incrementa +1 a cada mensagem de role CONTACT
                              // zerado via PATCH /v1/conversations/:contactId/read

// Campos de meta do contato (atualizados junto com o preview)
contactName: string | null    // payload.senderName do webhook
contactPhone: string          // número no formato E.164 (5511999999999)
status: string                // 'NEW_LEAD' | 'IN_PROGRESS' | 'CONVERTED' | ...
photoUrl?: string             // URL Firebase Storage (permanente) ou Z-API (temporária 48h)
```

### Grupo 2 — Dados completos do contato

Escrito por: `syncContact` (ao criar/editar contato via API)

```ts
id: string                          // UUID do contato no Postgres
phone: string
name: string | null
email: string | null
status: string
stageId: string | null              // currentStageId
funnelId: string | null             // currentFunnelId
lastMessageAt: Timestamp | null
assignedProfessionalId: string | null
updatedAt: Timestamp
```

### Grupo 3 — Indicadores de presença

Escritos por funções específicas:

```ts
contactTyping: boolean    // true quando o contato está digitando no WhatsApp
                          // escrito por setContactTyping (webhook PresenceChatCallback)

agentTyping: boolean      // true quando o agente IA está processando/respondendo
                          // escrito por setAgentTyping (módulo do agente)
```

### Interface TypeScript completa

```ts
interface FirestoreContact {
  // Identidade
  id?: string                         // presente quando syncContact foi chamado
  phone: string
  name?: string | null                // campo 'name' (syncContact)
  contactName?: string | null         // campo 'contactName' (syncConversationMessage)
  contactPhone?: string               // campo 'contactPhone' (syncConversationMessage)
  email?: string | null
  photoUrl?: string                   // URL permanente do Firebase Storage

  // Status / CRM
  status: string
  stageId?: string | null
  funnelId?: string | null
  assignedProfessionalId?: string | null

  // Preview da última mensagem
  lastMessage?: string
  lastMessageAt?: Timestamp | null

  // Contadores
  unreadCount?: number

  // Presença
  contactTyping?: boolean
  agentTyping?: boolean

  // Metadata
  updatedAt: Timestamp
}
```

> **Atenção:** `name` e `contactName` podem coexistir no mesmo doc. Use `contactName ?? name` para exibir.

**Como usar no frontend — lista de chats:**

```ts
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'

function subscribeToChats(
  tenantId: string,
  onUpdate: (contacts: FirestoreContact[]) => void,
) {
  const ref = collection(db, 'tenants', tenantId, 'contacts')
  const q = query(ref, orderBy('lastMessageAt', 'desc'), limit(50))

  return onSnapshot(q, (snapshot) => {
    const contacts = snapshot.docs.map((doc) => ({
      id: doc.id,           // ← ID do documento = contactId
      ...doc.data(),
    })) as FirestoreContact[]

    onUpdate(contacts)
  })
}

// Uso
useEffect(() => {
  const unsub = subscribeToChats(tenantId, setContacts)
  return () => unsub()
}, [tenantId])
```

**Como exibir nome e foto:**

```tsx
function ChatListItem({ contact }: { contact: FirestoreContact }) {
  const name = contact.contactName ?? contact.name ?? contact.contactPhone ?? contact.phone
  const photo = contact.photoUrl   // pode ser null — use fallback com iniciais

  return (
    <div>
      {photo ? (
        <img src={photo} alt={name} className="w-10 h-10 rounded-full object-cover" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center">
          <span>{name?.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div>
        <p>{name}</p>
        <p className="text-sm text-gray-500">{contact.lastMessage}</p>
      </div>
      {(contact.unreadCount ?? 0) > 0 && (
        <span className="bg-green-500 text-white rounded-full px-2 text-xs">
          {contact.unreadCount}
        </span>
      )}
    </div>
  )
}
```

---

## `tenants/{tenantId}/contacts/{contactId}/messages/{messageId}` — Mensagens

Escrito por: `syncConversationMessage`

```ts
interface FirestoreMessage {
  id: string                  // UUID da mensagem no Postgres
  role: 'CONTACT' | 'OPERATOR' | 'AGENT'
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT'   // tipo normalizado
  content: string             // texto ou legenda (max 100 chars no preview, ilimitado aqui)
  createdAt: Timestamp

  // Presente apenas em mensagens OPERATOR/AGENT — atualizado por updateMessageStatus
  status?: 'SENT' | 'RECEIVED' | 'READ' | 'PLAYED'
  updatedAt?: Timestamp       // presente quando status foi atualizado

  // Presente quando há mídia ou conteúdo especial
  metadata?: {
    // IMAGE
    imageUrl?: string
    thumbnailUrl?: string
    mimeType?: string
    width?: number
    height?: number
    viewOnce?: boolean
    caption?: string

    // AUDIO
    audioUrl?: string
    ptt?: boolean             // true = nota de voz gravada no WhatsApp
    seconds?: number

    // VIDEO
    videoUrl?: string
    mediaKind?: 'video' | 'sticker' | 'location' | 'contact' | 'template'

    // DOCUMENT
    documentUrl?: string
    fileName?: string

    // LOCATION
    latitude?: string
    longitude?: string
    address?: string

    // CONTACT (vCard)
    contactName?: string
    contactPhone?: string

    // LINK PREVIEW (texto com URL)
    url?: string

    // BOTÃO / LISTA (resposta do contato)
    buttonId?: string
    selectedRowId?: string

    // TEMPLATE
    templateId?: string
  }
}
```

**Quando `status` é atualizado:**

| Status | Webhook que dispara |
|--------|---------------------|
| `SENT` | `DeliveryCallback` |
| `RECEIVED` | `MessageStatusCallback` com status `RECEIVED` |
| `READ` | `MessageStatusCallback` com status `READ` |
| `PLAYED` | `MessageStatusCallback` com status `PLAYED` (áudio ouvido) |

**Como usar no frontend — mensagens do chat:**

```ts
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'

function subscribeToMessages(
  tenantId: string,
  contactId: string,
  onUpdate: (messages: FirestoreMessage[]) => void,
) {
  const ref = collection(db, 'tenants', tenantId, 'contacts', contactId, 'messages')
  const q = query(ref, orderBy('createdAt', 'asc'), limit(100))

  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as FirestoreMessage[]

    onUpdate(messages)
  })
}

useEffect(() => {
  if (!activeContactId) return
  const unsub = subscribeToMessages(tenantId, activeContactId, setMessages)
  return () => unsub()
}, [tenantId, activeContactId])
```

---

## `photoUrl` — ciclo de vida da foto

A foto de um contato passa por dois estágios:

```
Primeira mensagem chega (webhook)
  └─ senderPhoto (URL temporária Z-API, expira em 48h)
       └─ salvo em contact.photoUrl no Postgres
       └─ sincronizado em contacts/{id}.photoUrl no Firestore
       └─ photoSyncQueue.add({ tenantId, contactId }, delay: 2s)
            └─ Worker (background):
                 1. Z-API /profile-picture → URL temporária fresca
                 2. Download da imagem
                 3. Upload → Firebase Storage
                 4. URL permanente: https://storage.googleapis.com/...
                 5. Atualiza Postgres + Firestore
                      └─ onSnapshot → foto atualiza na UI automaticamente
```

**No frontend**, exiba `photoUrl` normalmente — pode ser temporária ou permanente. O `onSnapshot` vai atualizar quando o worker concluir (normalmente < 5s após a mensagem chegar).

**Para forçar re-sync manual** (ex: botão "atualizar foto"):

```ts
// Dispara em background — não precisa usar o retorno
// O onSnapshot vai atualizar a UI quando concluir
await fetch(`/v1/contacts/${contactId}/sync-photo`, {
  method: 'POST',
  credentials: 'include',
})
```

---

## Indicadores de digitação

```ts
// Escuta o doc do contato para typing indicators
import { doc, onSnapshot } from 'firebase/firestore'

const contactRef = doc(db, 'tenants', tenantId, 'contacts', contactId)

onSnapshot(contactRef, (snap) => {
  const data = snap.data()
  setContactTyping(data?.contactTyping ?? false)   // contato digitando no WhatsApp
  setIsAgentTyping(data?.agentTyping ?? false)     // agente IA processando
})

// Na UI
{contactTyping && <p className="text-xs text-gray-400 italic">digitando...</p>}
{agentTyping && <p className="text-xs text-blue-400 italic">agente escrevendo...</p>}
```

---

## Marcar como lido

Ao abrir um chat, zera o `unreadCount` no Firestore chamando o backend:

```ts
// Chame ao selecionar um chat — fire and forget
async function markAsRead(contactId: string) {
  await fetch(`/v1/conversations/${contactId}/read`, {
    method: 'PATCH',
    credentials: 'include',
  })
  // Firestore atualiza automaticamente: unreadCount → 0
}

useEffect(() => {
  if (activeContactId) void markAsRead(activeContactId)
}, [activeContactId])
```

---

## `tenants/{tenantId}/appointments/{id}` — Agendamentos

Escrito por: `syncAppointment`

```ts
interface FirestoreAppointment {
  id: string
  contactId: string
  professionalId: string
  serviceId: string
  scheduledAt: Timestamp
  durationMin: number
  status: string              // 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'
  notes: string | null
  updatedAt: Timestamp
}
```

---

## `tenants/{tenantId}/charges/{id}` — Cobranças

Escrito por: `syncCharge`

```ts
interface FirestoreCharge {
  id: string
  contactId: string
  amount: string              // convertido para string (era Decimal no Postgres)
  description: string
  status: string              // 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  pixCopyPaste: string | null
  dueAt: Timestamp | null
  paidAt: Timestamp | null
  updatedAt: Timestamp
}
```

---

## Regras de segurança do Firestore recomendadas

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Tenant raiz e todas as subcoleções
    match /tenants/{tenantId}/{document=**} {
      allow read: if request.auth != null
                  && request.auth.token.tenantId == tenantId;
      allow write: if false;   // apenas Admin SDK escreve
    }
  }
}
```

O `request.auth.token.tenantId` vem do custom token gerado em `GET /v1/auth/firebase-token`, que inclui o `tenantId` como claim adicional.

---

## Checklist de integração

- [ ] Chamar `GET /v1/auth/firebase-token` após `setActive()` — armazenar `tenantId` e autenticar no Firebase Auth com `signInWithCustomToken`
- [ ] Usar **sempre** o `tenantId` retornado pelo backend (UUID do Postgres), nunca o `activeOrganizationId` do better-auth
- [ ] `onSnapshot` na coleção `contacts` para a lista de chats
- [ ] `onSnapshot` na subcoleção `messages` ao abrir um chat
- [ ] `onSnapshot` no doc do contato para `contactTyping` e `agentTyping`
- [ ] `onSnapshot` no doc do tenant para `whatsappConnected`
- [ ] `PATCH /v1/conversations/:contactId/read` ao abrir um chat
- [ ] Exibir `photoUrl` com fallback de iniciais quando null
- [ ] Tratar `contactName ?? name` para o nome do contato
- [ ] Desinscrever todos os listeners (`unsubscribe()`) ao desmontar componentes
