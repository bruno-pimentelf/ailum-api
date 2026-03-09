# Tenant Logo — Frontend (Next.js)

O backend não faz upload. O front envia direto a URL para `PATCH /v1/tenant`.

## Fluxo

1. Usuário escolhe a imagem (input file)
2. Upload para Firebase Storage (client SDK)
3. Obter URL pública
4. `PATCH /v1/tenant` com `{ "logoUrl": "https://storage.googleapis.com/..." }`

## Exemplo (Firebase Storage Client)

```ts
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'

async function uploadTenantLogo(tenantId: string, file: File): Promise<string> {
  const storage = getStorage()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `tenants/${tenantId}/logo.${ext}`
  const fileRef = ref(storage, path)

  await uploadBytes(fileRef, file, { contentType: file.type })
  return getDownloadURL(fileRef)
}

// No form submit:
const url = await uploadTenantLogo(tenantId, file)
await fetch('/api/v1/tenant', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ logoUrl: url }),
})
```

## Regras do Storage

- Caminho: `tenants/{tenantId}/logo.{ext}`
- Bucket deve permitir leitura pública (ou use signed URLs se preferir privacidade)
- Tipos aceitos: jpg, png, webp

## API

```
PATCH /v1/tenant
{ "logoUrl": "https://storage.googleapis.com/..." }
```
