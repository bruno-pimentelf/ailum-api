import { Type } from '@sinclair/typebox'

export const UpsertZapiSchema = Type.Object({
  instanceId: Type.String({ minLength: 1 }),
  instanceToken: Type.String({ minLength: 1 }),
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
