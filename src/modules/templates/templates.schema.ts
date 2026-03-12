import { Type } from '@sinclair/typebox'

const TemplateTypeEnum = Type.Union([
  Type.Literal('TEXT'),
  Type.Literal('IMAGE'),
  Type.Literal('AUDIO'),
  Type.Literal('VIDEO'),
  Type.Literal('DOCUMENT'),
])

export const TemplateParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const CreateTemplateSchema = Type.Object({
  key: Type.String({ minLength: 1, pattern: '^[a-z0-9_-]+$' }),
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  type: TemplateTypeEnum,
  body: Type.String({ minLength: 1 }),
  mediaUrl: Type.Optional(Type.String()),
  caption: Type.Optional(Type.String()),
  fileName: Type.Optional(Type.String()),
  variables: Type.Optional(Type.Array(Type.String())),
})

export const UpdateTemplateSchema = Type.Partial(
  Type.Omit(CreateTemplateSchema, ['key']),
)
