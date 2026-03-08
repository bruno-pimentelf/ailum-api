import { Type } from '@sinclair/typebox'

export const UpsertZapiSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  clientToken: Type.String({ minLength: 1 }),
  webhookToken: Type.Optional(Type.String()),
})

export const UpsertAsaasSchema = Type.Object({
  apiKey: Type.String({ minLength: 1 }),
})

export const ProviderParamsSchema = Type.Object({
  provider: Type.Union([
    Type.Literal('zapi'),
    Type.Literal('asaas'),
    Type.Literal('elevenlabs'),
  ]),
})
