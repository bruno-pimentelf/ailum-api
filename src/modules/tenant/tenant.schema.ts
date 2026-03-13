import { Type } from '@sinclair/typebox'

export const UpdateTenantSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  isAgentEnabledForWhatsApp: Type.Optional(Type.Boolean()),
  isSlotRecallEnabled: Type.Optional(Type.Boolean()),
  agentBasePrompt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  guardrailRules: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  description: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  email: Type.Optional(Type.String({ format: 'email' })),
  website: Type.Optional(Type.String()),
  logoUrl: Type.Optional(Type.String()),

  addressStreet: Type.Optional(Type.String()),
  addressNumber: Type.Optional(Type.String()),
  addressComplement: Type.Optional(Type.String()),
  addressNeighborhood: Type.Optional(Type.String()),
  addressCity: Type.Optional(Type.String()),
  addressState: Type.Optional(Type.String()),
  addressZip: Type.Optional(Type.String()),
})
