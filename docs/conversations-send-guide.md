# Guia de Envio de Mensagens — Integração Frontend

## Princípio fundamental

**O retorno do POST nunca é usado para atualizar a UI.**

O único fluxo válido é:

```
Operador clica em enviar
  └─► POST /v1/conversations/:contactId/messages
        └─► Backend salva no Postgres
        └─► Backend envia para Z-API
        └─► Backend escreve no Firestore
              └─► onSnapshot dispara automaticamente
                    └─► Mensagem aparece na tela
```

O `{ id }` que o endpoint retorna existe apenas para casos de debug. **Nunca** use o retorno do POST para inserir a mensagem na UI — isso causaria duplicação quando o Firestore atualizar.

---

## Endpoint único

```
POST /v1/conversations/:contactId/messages
```

**Headers obrigatórios:**
```
Content-Type: application/json
```
Autenticação via cookie de sessão (`credentials: 'include'`).

**Resposta de sucesso:** `201 Created`
```json
{ "id": "uuid-da-mensagem-no-postgres" }
```

**Ignore o retorno na UI.** O Firestore já vai atualizar via `onSnapshot`.

---

## Padrão de envio recomendado

```ts
// Função base — use para todos os tipos
async function sendMessage(contactId: string, payload: object) {
  const res = await fetch(`/v1/conversations/${contactId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error ?? 'Erro ao enviar mensagem')
  }

  // ✅ Não retorna nada para a UI — o onSnapshot cuida disso
}
```

---

## Todos os tipos de mensagem

### TEXT

```ts
await sendMessage(contactId, {
  type: 'TEXT',
  text: 'Olá! Como posso ajudar?',
})
```

---

### IMAGE

Aceita URL pública ou base64 (`data:image/jpeg;base64,...`).

```ts
// Via URL
await sendMessage(contactId, {
  type: 'IMAGE',
  mediaUrl: 'https://storage.ailum.io/imagens/foto.jpg',
  caption: 'Segue a imagem!',   // opcional
})

// Via seleção de arquivo no browser
async function sendImageFile(contactId: string, file: File, caption?: string) {
  const reader = new FileReader()
  reader.readAsDataURL(file)
  reader.onload = async () => {
    await sendMessage(contactId, {
      type: 'IMAGE',
      mediaUrl: reader.result as string,  // base64 completo com data:image/...
      caption,
    })
  }
}
```

---

### AUDIO (nota de voz)

Aceita URL ou base64. Para gravar diretamente no browser:

```ts
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []

  recorder.ondataavailable = (e) => chunks.push(e.data)

  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' })
    const reader = new FileReader()
    reader.readAsDataURL(blob)
    reader.onload = async () => {
      await sendMessage(contactId, {
        type: 'AUDIO',
        mediaUrl: reader.result as string,
      })
    }
    stream.getTracks().forEach(t => t.stop())
  }

  return recorder  // chame recorder.stop() quando o usuário parar
}
```

---

### VIDEO

```ts
await sendMessage(contactId, {
  type: 'VIDEO',
  mediaUrl: 'https://storage.ailum.io/videos/apresentacao.mp4',
  caption: 'Assista ao vídeo explicativo',  // opcional
})
```

---

### DOCUMENT (PDF, DOCX, XLSX, etc.)

```ts
await sendMessage(contactId, {
  type: 'DOCUMENT',
  mediaUrl: 'https://storage.ailum.io/docs/contrato.pdf',
  fileName: 'contrato-consulta.pdf',
})

// Via seleção de arquivo
async function sendDocumentFile(contactId: string, file: File) {
  const reader = new FileReader()
  reader.readAsDataURL(file)
  reader.onload = async () => {
    await sendMessage(contactId, {
      type: 'DOCUMENT',
      mediaUrl: reader.result as string,
      fileName: file.name,
    })
  }
}
```

---

### STICKER

```ts
await sendMessage(contactId, {
  type: 'STICKER',
  mediaUrl: 'https://storage.ailum.io/stickers/ok.webp',
})
```

---

### LOCATION

```ts
// Endereço fixo da clínica
await sendMessage(contactId, {
  type: 'LOCATION',
  latitude: '-23.5505',
  longitude: '-46.6333',
  locationTitle: 'Clínica Ailum',
  locationAddress: 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP',
})

// Localização atual do usuário
navigator.geolocation.getCurrentPosition(async ({ coords }) => {
  await sendMessage(contactId, {
    type: 'LOCATION',
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    locationTitle: 'Nossa localização',
    locationAddress: '',
  })
})
```

---

### CONTACT (compartilhar contato)

```ts
await sendMessage(contactId, {
  type: 'CONTACT',
  contactName: 'Dra. Ana Souza',
  contactPhone: '5511988887777',  // formato internacional sem + ou espaços
})
```

---

### REACTION (reagir a uma mensagem)

> ⚠️ Reações **não geram documento novo** no Firestore. São enviadas direto ao WhatsApp e não aparecem como mensagem na timeline.

O `replyToZapiMessageId` é o `zapiMessageId` da mensagem que você quer reagir. Para obtê-lo, você precisa tê-lo salvo no documento do Firestore — mas atualmente o campo `zapiMessageId` **não é sincronizado** para o Firestore por padrão. Se quiser suportar reações, salve o `zapiMessageId` no Firestore junto com cada mensagem ou use o `id` interno como referência.

```ts
await sendMessage(contactId, {
  type: 'REACTION',
  reaction: '❤️',
  replyToZapiMessageId: 'D241XXXX732339502B68',
})
```

---

## Tratamento de erros

```ts
async function sendMessageSafe(contactId: string, payload: object) {
  try {
    await sendMessage(contactId, payload)
    // ✅ Não faz nada — o onSnapshot vai atualizar a UI
  } catch (err) {
    // ❌ Mostra toast de erro para o operador
    toast.error(err instanceof Error ? err.message : 'Falha ao enviar')
  }
}
```

**Códigos de erro possíveis:**

| Status | Significado |
|--------|-------------|
| `400` | Campos obrigatórios faltando (ex: `text` vazio, `mediaUrl` ausente) |
| `401` | Sessão expirada — redirecionar para login |
| `403` | Sem permissão (`CONTACTS_WRITE` necessário) |
| `404` | `contactId` não existe neste tenant |
| `500` | Z-API indisponível ou credenciais inválidas |

---

## Estado de loading na UI

Como o Firestore é a fonte da verdade, o loading deve ser tratado assim:

```tsx
const [sending, setSending] = useState(false)

async function handleSend(text: string) {
  setSending(true)
  try {
    await sendMessage(contactId, { type: 'TEXT', text })
    clearInput()
    // ✅ Não atualiza a lista de mensagens aqui — o onSnapshot cuida disso
  } catch (err) {
    toast.error('Falha ao enviar')
  } finally {
    setSending(false)
  }
}
```

**Nunca** adicione a mensagem otimisticamente ao estado local antes do Firestore confirmar — o backend precisa salvar, enviar para Z-API e escrever no Firestore antes de aparecer. A latência típica é < 500ms, o que é suficiente para uma boa UX com o indicador de loading.

---

## Upload de arquivos para URL pública

A Z-API aceita base64 diretamente, mas para arquivos grandes (vídeos, documentos) é melhor fazer upload para um storage e enviar a URL.

Recomendação: use **Supabase Storage** ou **Cloudflare R2** e gere uma URL pública antes de chamar o endpoint.

```ts
// Exemplo com Supabase Storage
async function uploadAndSend(contactId: string, file: File, type: 'IMAGE' | 'VIDEO' | 'DOCUMENT') {
  // 1. Upload para storage
  const { data, error } = await supabase.storage
    .from('attachments')
    .upload(`${tenantId}/${Date.now()}-${file.name}`, file)

  if (error) throw error

  const { data: { publicUrl } } = supabase.storage
    .from('attachments')
    .getPublicUrl(data.path)

  // 2. Envia via backend
  await sendMessage(contactId, {
    type,
    mediaUrl: publicUrl,
    fileName: file.name,   // para DOCUMENT
  })
}
```

---

## Marcar conversa como lida

Chamado automaticamente ao abrir um chat. Zera o `unreadCount` no Firestore.

```ts
async function markAsRead(contactId: string) {
  await fetch(`/v1/conversations/${contactId}/read`, {
    method: 'PATCH',
    credentials: 'include',
  })
  // Firestore atualiza automaticamente — não precisa fazer nada na UI
}

// Chame ao selecionar um chat
useEffect(() => {
  if (activeContactId) markAsRead(activeContactId)
}, [activeContactId])
```

---

## Resumo: o que fazer e o que não fazer

| ✅ Fazer | ❌ Não fazer |
|---------|-------------|
| Mostrar spinner enquanto `sending === true` | Adicionar mensagem otimisticamente ao estado |
| Mostrar toast de erro se o POST falhar | Usar o retorno do POST para atualizar a UI |
| Deixar o `onSnapshot` atualizar a lista | Recarregar mensagens após enviar |
| Limpar o input após o POST completar | Limpar só após o Firestore confirmar |
| Desabilitar botão de envio durante `sending` | Bloquear o `onSnapshot` durante envio |
