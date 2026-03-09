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

## GET /v1/integrations/zapi/test

Verifica se a instância Z-API está online e conectada ao WhatsApp.

**Response 200**
```json
{ "connected": true, "phone": "5511999999999" }
```
```json
{ "connected": false, "phone": null }
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
