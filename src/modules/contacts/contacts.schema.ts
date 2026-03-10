import { Type } from '@sinclair/typebox'

export const ContactParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const ListContactsQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  funnelId: Type.Optional(Type.String({ format: 'uuid' })),
  stageId: Type.Optional(Type.String({ format: 'uuid' })),
  status: Type.Optional(Type.String()),
  search: Type.Optional(Type.String()),
})

export const CreateContactSchema = Type.Object({
  phone: Type.String({ minLength: 8 }),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String({ format: 'email' })),
  notes: Type.Optional(Type.String()),
  funnelId: Type.Optional(Type.String({ format: 'uuid' })),
  stageId: Type.Optional(Type.String({ format: 'uuid' })),
  assignedProfessionalId: Type.Optional(Type.String({ format: 'uuid' })),
})

export const UpdateContactSchema = Type.Object({
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String({ format: 'email' })),
  notes: Type.Optional(Type.String()),
  assignedProfessionalId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
})

export const MoveStageSchema = Type.Object({
  stageId: Type.String({ format: 'uuid' }),
  funnelId: Type.Optional(Type.String({ format: 'uuid' })),
})
