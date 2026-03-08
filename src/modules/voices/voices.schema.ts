import { Type } from '@sinclair/typebox'

export const VoiceParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) })

export const CreateVoiceSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  provider: Type.Union([
    Type.Literal('ELEVENLABS'),
    Type.Literal('AZURE'),
    Type.Literal('OPENAI'),
  ]),
  providerVoiceId: Type.String({ minLength: 1 }),
  sampleUrl: Type.Optional(Type.String({ format: 'uri' })),
})

export const UpdateVoiceSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  sampleUrl: Type.Optional(Type.Union([Type.String({ format: 'uri' }), Type.Null()])),
})
