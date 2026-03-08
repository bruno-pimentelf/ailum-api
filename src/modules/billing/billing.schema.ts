import { Type } from '@sinclair/typebox'

export const ChargeParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const ListChargesQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  contactId: Type.Optional(Type.String({ format: 'uuid' })),
  status: Type.Optional(Type.String()),
  from: Type.Optional(Type.String({ format: 'date' })),
  to: Type.Optional(Type.String({ format: 'date' })),
})

export const CreateChargeSchema = Type.Object({
  contactId: Type.String({ format: 'uuid' }),
  appointmentId: Type.Optional(Type.String({ format: 'uuid' })),
  amount: Type.Number({ minimum: 0.01 }),
  description: Type.String({ minLength: 1 }),
  dueHours: Type.Optional(Type.Number({ minimum: 1, default: 24 })),
})
