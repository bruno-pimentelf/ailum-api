# Integrations API

> Base: `POST /v1/integrations`  
> Auth: cookie de sessão (`credentials: 'include'`) + organização ativa na sessão  
> Role mínima: **ADMIN**

---

## GET /v1/integrations

Lista todas as integrações. API keys nunca são retornadas.

**Response 200**
```json
[
  {
    "provider": "zapi",
    "instanceId": "3EE8E4989B1AF28A1F35E28BEEFEC97F",
    "webhookToken": null,
    "isActive": true,
    "hasApiKey": true
  },
  {
    "provider": "asaas",
    "instanceId": null,
    "webhookToken": null,
    "isActive": true,
    "hasApiKey": true
  }
]
```

---

## PUT /v1/integrations/zapi

Salva credenciais Z-API **e auto-configura os webhooks** na instância.

**Body**
```json
{
  "instanceId": "3EE8E4989B1AF28A1F35E28BEEFEC97F",
  "instanceToken": "DDF6170F74BC3D70AD91CBE5"
}
```

**Response 200**
```json
{
  "provider": "zapi",
  "instanceId": "3EE8E4989B1AF28A1F35E28BEEFEC97F",
  "webhookToken": null,
  "isActive": true,
  "hasApiKey": true,
  "webhooksConfigured": true,
  "webhooksError": null
}
```

> `webhooksConfigured: false` + `webhooksError: "..."` = credenciais inválidas ou instância offline

---

## GET /v1/integrations/zapi/status

Status da conexão da instância com o WhatsApp.

**Response 200**
```json
{ "connected": true, "smartphoneConnected": true, "error": null }
```
```json
{ "connected": false, "smartphoneConnected": false, "error": "You are not connected." }
```

---

## GET /v1/integrations/zapi/qrcode

Retorna o QR code em base64 para escanear com o WhatsApp.  
⚠️ O QR code expira a cada 20s — fazer polling a cada 10-15s até `connected: true` no status.  
Retorna `404` se a instância já estiver conectada ou não configurada.

**Response 200**
```json
{ "value": "data:image/png;base64,iVBORw0KGgo..." }
```

---

## POST /v1/integrations/zapi/disconnect

Desconecta o WhatsApp da instância. Para reconectar é necessário escanear o QR code novamente.

**Response 200**
```json
{ "disconnected": true }
```

---

## POST /v1/integrations/zapi/restart

Reinicia a instância Z-API (equivale a um CTRL+ALT+DEL — não desconecta o número).

**Response 200**
```json
{ "restarted": true }
```

---

## PUT /v1/integrations/asaas

Salva a API key do Asaas.

**Body**
```json
{ "apiKey": "$aact_MzkwODA..." }
```

**Response 200**
```json
{
  "provider": "asaas",
  "instanceId": null,
  "webhookToken": null,
  "isActive": true,
  "hasApiKey": true
}
```

---

## DELETE /v1/integrations/:provider

Desativa uma integração. `provider` = `zapi` | `asaas` | `elevenlabs`

**Response 204** — sem body
