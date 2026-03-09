# Guia: Réplica do WhatsApp Web no Frontend

## Filosofia central

**A tela de conversas não faz nenhum `GET` para o backend da Ailum.**

Toda a interface é alimentada por `onSnapshot` do Firestore em tempo real. O backend só é chamado quando o operador **envia** algo. Isso garante:

- Zero latency na atualização da UI
- Sem polling, sem estado desatualizado
- Sincronização automática entre múltiplos operadores abertos na mesma conta

---

## Estrutura de dados no Firestore

```
tenants/{tenantId}/
  contacts/{contactId}          ← lista de chats (coluna esquerda)
  contacts/{contactId}/
    messages/{messageId}        ← mensagens do chat aberto
```

### Documento `contacts/{contactId}`

```ts
interface FirestoreContact {
  id: string
  phone: string
  name: string | null
  email: string | null
  status: string              // 'NEW_LEAD' | 'IN_PROGRESS' | 'CONVERTED' | ...
  stageId: string | null
  funnelId: string | null
  lastMessage: string         // preview da última mensagem (max 100 chars)
  lastMessageAt: Timestamp
  unreadCount: number         // zerado via PATCH /v1/conversations/:contactId/read
  contactTyping: boolean      // contato está digitando no WhatsApp
  agentTyping: boolean        // agente IA está digitando
  whatsappConnected: boolean  // status da instância (no doc do tenant raiz)
  assignedProfessionalId: string | null
  updatedAt: Timestamp
}
```

### Documento `messages/{messageId}`

```ts
interface FirestoreMessage {
  id: string
  role: 'CONTACT' | 'OPERATOR' | 'AGENT'
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT'   // tipo normalizado do Postgres
  content: string             // texto principal ou legenda
  createdAt: Timestamp
  status?: 'SENT' | 'RECEIVED' | 'READ' | 'PLAYED' // só para mensagens OPERATOR/AGENT
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
    ptt?: boolean             // true = gravado no WhatsApp (voz)
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

    // REACTION
    // (reações não geram documento próprio)

    // LINK PREVIEW (texto com URL)
    url?: string
  }
}
```

---

## Setup do Firebase no Frontend

```ts
// lib/firebase.ts
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, signInWithCustomToken } from 'firebase/auth'

const app = initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
})

export const db = getFirestore(app)
export const firebaseAuth = getAuth(app)
```

## ⚠️ Mismatch de tenantId — leia com atenção

O better-auth expõe na sessão o `activeOrganizationId` (um ID alfanumérico como `org_abc123`).
O Firestore usa como chave o **UUID interno do Postgres** (ex: `34ba07a9-0af3-465f-99e0-335ce9db0e71`).

**São IDs diferentes. Nunca use `activeOrganizationId` para montar paths do Firestore.**

### Como obter o tenantId correto

Chame `GET /v1/auth/firebase-token` logo após setar a organização ativa. Esse endpoint retorna os dois dados necessários de uma vez:

```ts
// lib/firebase-session.ts
import { signInWithCustomToken } from 'firebase/auth'
import { firebaseAuth } from './firebase'

interface FirebaseTokenResponse {
  token: string
  tenantId: string   // UUID do Postgres — use este em todos os paths do Firestore
}

export async function initFirebaseSession(apiBaseUrl: string): Promise<string> {
  const res = await fetch(`${apiBaseUrl}/v1/auth/firebase-token`, {
    credentials: 'include',   // envia o cookie de sessão do better-auth
  })

  if (!res.ok) throw new Error('Falha ao obter firebase token')

  const { token, tenantId }: FirebaseTokenResponse = await res.json()

  // Autentica no Firebase Auth (necessário para as Security Rules)
  await signInWithCustomToken(firebaseAuth, token)

  // Retorna o tenantId para ser armazenado no contexto/store da aplicação
  return tenantId
}
```

### Quando chamar

```ts
// Chame sempre após definir a organização ativa no better-auth
const { error } = await authClient.organization.setActive({ organizationId })
if (!error) {
  const tenantId = await initFirebaseSession(process.env.NEXT_PUBLIC_API_URL)
  // Armazene no contexto global (Zustand, Context API, etc.)
  setTenantId(tenantId)
}
```

### Armazenando no contexto (exemplo com Zustand)

```ts
interface AppStore {
  tenantId: string | null
  setTenantId: (id: string) => void
}

export const useAppStore = create<AppStore>((set) => ({
  tenantId: null,
  setTenantId: (tenantId) => set({ tenantId }),
}))
```

### Usando nos listeners do Firestore

```ts
// ✅ Correto — usa o tenantId retornado pelo backend
const tenantId = useAppStore((s) => s.tenantId)
const ref = collection(db, 'tenants', tenantId, 'contacts')

// ❌ Errado — organizationId do better-auth é diferente do tenantId do Firestore
const { data: session } = await authClient.getSession()
const ref = collection(db, 'tenants', session.session.activeOrganizationId, 'contacts')
```

---

## Coluna esquerda — Lista de chats

### Listener (onSnapshot)

```ts
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

function subscribeToChats(tenantId: string, callback: (contacts: FirestoreContact[]) => void) {
  const ref = collection(db, 'tenants', tenantId, 'contacts')
  const q = query(ref, orderBy('lastMessageAt', 'desc'), limit(50))

  return onSnapshot(q, (snapshot) => {
    const contacts = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as FirestoreContact[]

    callback(contacts)
  })
}

// Uso no componente (React)
useEffect(() => {
  const unsubscribe = subscribeToChats(tenantId, setContacts)
  return () => unsubscribe()
}, [tenantId])
```

### O que atualiza a lista automaticamente

| Evento | O que muda no doc do contato |
|--------|------------------------------|
| Mensagem recebida | `lastMessage`, `lastMessageAt`, `unreadCount + 1` |
| Mensagem enviada (operator) | `lastMessage`, `lastMessageAt` |
| Contato digitando | `contactTyping: true/false` |
| Agente IA digitando | `agentTyping: true/false` |
| Leitura marcada | `unreadCount: 0` |

---

## Coluna direita — Mensagens do chat aberto

### Listener (onSnapshot)

```ts
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

function subscribeToMessages(
  tenantId: string,
  contactId: string,
  callback: (messages: FirestoreMessage[]) => void,
) {
  const ref = collection(db, 'tenants', tenantId, 'contacts', contactId, 'messages')
  const q = query(ref, orderBy('createdAt', 'asc'), limit(100))

  return onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as FirestoreMessage[]

    callback(messages)
  })
}

// Ao abrir um chat
useEffect(() => {
  if (!activeContactId) return
  const unsubscribe = subscribeToMessages(tenantId, activeContactId, setMessages)
  return () => unsubscribe()
}, [tenantId, activeContactId])
```

### Marcar como lido ao abrir o chat

```ts
// Assim que o chat é aberto, zeramos o unreadCount via backend
async function markAsRead(contactId: string) {
  await fetch(`/v1/conversations/${contactId}/read`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
}

useEffect(() => {
  if (activeContactId) markAsRead(activeContactId)
}, [activeContactId])
```

---

## Envio de mensagens — `POST /v1/conversations/:contactId/messages`

**Header obrigatório em todos os requests:**
```
Authorization: Bearer <session_token>
Content-Type: application/json
```

---

### Texto simples

```ts
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'TEXT',
    text: 'Olá, tudo bem?',
  }),
})
```

---

### Imagem

Faça upload do arquivo para seu storage (S3, Supabase Storage, etc.) e envie a URL pública. Alternativamente, converta para base64.

```ts
// Via URL
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'IMAGE',
    mediaUrl: 'https://seu-storage.com/imagem.jpg',
    caption: 'Segue a foto!',      // opcional
  }),
})

// Via base64
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'IMAGE',
    mediaUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgAB...',
    caption: 'Segue a foto!',
  }),
})
```

**Helper para converter File → base64:**
```ts
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
```

---

### Áudio / Nota de voz

```ts
// Gravar no browser com MediaRecorder e enviar como base64
const mediaRecorder = new MediaRecorder(stream)
const chunks: Blob[] = []

mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
mediaRecorder.onstop = async () => {
  const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' })
  const base64 = await fileToBase64(new File([blob], 'audio.ogg'))

  await fetch(`/v1/conversations/${contactId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'AUDIO',
      mediaUrl: base64,
    }),
  })
}
```

---

### Vídeo

```ts
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'VIDEO',
    mediaUrl: 'https://seu-storage.com/video.mp4',
    caption: 'Assista!',           // opcional
  }),
})
```

---

### Documento / Arquivo

```ts
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'DOCUMENT',
    mediaUrl: 'https://seu-storage.com/contrato.pdf',
    fileName: 'contrato-consulta.pdf',
  }),
})
```

---

### Sticker

```ts
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'STICKER',
    mediaUrl: 'https://seu-storage.com/sticker.webp',
  }),
})
```

---

### Localização

```ts
// Com geolocation da API do browser
navigator.geolocation.getCurrentPosition(async ({ coords }) => {
  await fetch(`/v1/conversations/${contactId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'LOCATION',
      latitude: String(coords.latitude),
      longitude: String(coords.longitude),
      locationTitle: 'Nossa clínica',
      locationAddress: 'Av. Paulista, 1000 - São Paulo, SP',
    }),
  })
})

// Hardcoded (endereço fixo da clínica)
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'LOCATION',
    latitude: '-23.5612',
    longitude: '-46.6561',
    locationTitle: 'Clínica Ailum',
    locationAddress: 'Rua das Flores, 123 - São Paulo, SP',
  }),
})
```

---

### Contato (vCard)

```ts
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'CONTACT',
    contactName: 'Dra. Ana Souza',
    contactPhone: '5511988887777',
  }),
})
```

---

### Reação a uma mensagem

```ts
// replyToZapiMessageId = message.id do Firestore é o zapiMessageId no banco
await fetch(`/v1/conversations/${contactId}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    type: 'REACTION',
    reaction: '❤️',
    replyToZapiMessageId: 'D241XXXX732339502B68',  // zapiMessageId da mensagem
  }),
})
```

> **Atenção:** reações não geram um documento novo de mensagem no Firestore. Elas são enviadas direto para o WhatsApp.

---

## Renderização das mensagens

```tsx
function MessageBubble({ message }: { message: FirestoreMessage }) {
  const isMe = message.role === 'OPERATOR' || message.role === 'AGENT'

  return (
    <div className={isMe ? 'ml-auto bg-green-100' : 'mr-auto bg-white'}>

      {/* TEXTO */}
      {message.type === 'TEXT' && !message.metadata?.mediaKind && (
        <p>{message.content}</p>
      )}

      {/* IMAGEM */}
      {message.type === 'IMAGE' && (
        <img src={message.metadata?.imageUrl as string} alt={message.content} />
      )}

      {/* ÁUDIO */}
      {message.type === 'AUDIO' && (
        <audio controls src={message.metadata?.audioUrl as string} />
      )}

      {/* VÍDEO */}
      {message.type === 'DOCUMENT' && message.metadata?.mediaKind === 'video' && (
        <video controls src={message.metadata?.videoUrl as string} />
      )}

      {/* DOCUMENTO */}
      {message.type === 'DOCUMENT' && !message.metadata?.mediaKind && (
        <a href={message.metadata?.documentUrl as string} download>
          📄 {message.metadata?.fileName as string || message.content}
        </a>
      )}

      {/* LOCALIZAÇÃO */}
      {message.metadata?.mediaKind === 'location' && (
        <a
          href={`https://maps.google.com/?q=${message.metadata.latitude},${message.metadata.longitude}`}
          target="_blank"
        >
          📍 {message.content}
        </a>
      )}

      {/* CONTATO */}
      {message.metadata?.mediaKind === 'contact' && (
        <div>
          👤 {message.metadata.contactName as string}
          <br />
          {message.metadata.contactPhone as string}
        </div>
      )}

      {/* STICKER */}
      {message.metadata?.mediaKind === 'sticker' && (
        <img src={message.metadata?.stickerUrl as string} alt="sticker" className="w-24" />
      )}

      {/* STATUS (apenas mensagens enviadas) */}
      {isMe && message.status && (
        <span className="text-xs text-gray-400">
          {message.status === 'SENT' && '✓'}
          {message.status === 'RECEIVED' && '✓✓'}
          {message.status === 'READ' && '✓✓ (azul)'}
          {message.status === 'PLAYED' && '▶ ouvido'}
        </span>
      )}
    </div>
  )
}
```

---

## Indicadores de presença e digitação

```tsx
// No chat aberto, escute o doc do contato para pegar contactTyping e agentTyping
import { doc, onSnapshot } from 'firebase/firestore'

const contactRef = doc(db, 'tenants', tenantId, 'contacts', contactId)

onSnapshot(contactRef, (snap) => {
  const data = snap.data()
  setIsContactTyping(data?.contactTyping ?? false)
  setIsAgentTyping(data?.agentTyping ?? false)
})

// Na UI
{(isContactTyping || isAgentTyping) && (
  <div className="text-xs text-gray-400 italic">
    {isContactTyping ? 'digitando...' : 'agente escrevendo...'}
  </div>
)}
```

---

## Status da instância WhatsApp

O status de conexão da instância fica no documento raiz do tenant:

```ts
import { doc, onSnapshot } from 'firebase/firestore'

const tenantRef = doc(db, 'tenants', tenantId)

onSnapshot(tenantRef, (snap) => {
  const data = snap.data()
  setWhatsappConnected(data?.whatsappConnected ?? false)
})

// Na UI — banner de aviso
{!whatsappConnected && (
  <div className="bg-red-100 text-red-700 p-2 text-sm">
    ⚠️ WhatsApp desconectado. Acesse Integrações para reconectar.
  </div>
)}
```

---

## Resumo: o que nunca fazer nessa tela

| ❌ Não fazer | ✅ Fazer |
|-------------|---------|
| `GET /conversations` para listar chats | `onSnapshot` na collection `contacts` |
| `GET /conversations/:id/messages` para listar mensagens | `onSnapshot` na subcollection `messages` |
| Polling de status de conexão | `onSnapshot` no doc do tenant |
| Polling de digitação | `onSnapshot` no doc do contato |
| Recarregar mensagens após enviar | O Firestore atualiza automaticamente via webhook |
| Armazenar mensagens no estado local indefinidamente | Deixe o Firestore ser a única fonte de verdade |

---

## Fluxo completo de uma mensagem

```
Operador digita e clica em enviar
  └─► POST /v1/conversations/:contactId/messages
        └─► Backend salva no Postgres (role: OPERATOR)
        └─► Backend envia para Z-API
        └─► Backend sincroniza no Firestore
              └─► onSnapshot dispara no front
                    └─► Mensagem aparece na tela instantaneamente

Contato responde no WhatsApp
  └─► Z-API dispara webhook POST /webhooks/zapi
        └─► Backend salva no Postgres (role: CONTACT)
        └─► Backend sincroniza no Firestore
              └─► onSnapshot dispara no front
                    └─► Mensagem aparece na tela instantaneamente

Contato leu a mensagem
  └─► Z-API dispara MessageStatusCallback (READ)
        └─► Backend atualiza status no Firestore
              └─► onSnapshot atualiza o ✓✓ azul na tela
```
