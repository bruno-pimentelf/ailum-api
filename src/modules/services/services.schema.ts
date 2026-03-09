import { Type } from '@sinclair/typebox'

export const ServiceParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) })

export const CreateServiceSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  durationMin: Type.Optional(Type.Integer({ minimum: 5, default: 50 })),
  price: Type.Number({ minimum: 0 }),
  isConsultation: Type.Optional(Type.Boolean({ default: true })),
})

export const UpdateServiceSchema = Type.Partial(CreateServiceSchema)
