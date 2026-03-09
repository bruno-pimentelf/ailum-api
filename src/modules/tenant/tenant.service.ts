import type { PrismaClient } from '../../generated/prisma/client.js'

const TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  plan: true,
  isAgentEnabledForWhatsApp: true,
  logoUrl: true,
  description: true,
  phone: true,
  email: true,
  website: true,
  addressStreet: true,
  addressNumber: true,
  addressComplement: true,
  addressNeighborhood: true,
  addressCity: true,
  addressState: true,
  addressZip: true,
  createdAt: true,
} as const

export async function getTenant(db: PrismaClient, tenantId: string) {
  return db.tenant.findUnique({
    where: { id: tenantId },
    select: TENANT_SELECT,
  })
}

export async function updateTenant(
  db: PrismaClient,
  tenantId: string,
  body: {
    name?: string
    isAgentEnabledForWhatsApp?: boolean
    description?: string
    phone?: string
    email?: string
    website?: string
    logoUrl?: string
    addressStreet?: string
    addressNumber?: string
    addressComplement?: string
    addressNeighborhood?: string
    addressCity?: string
    addressState?: string
    addressZip?: string
  },
) {
  return db.tenant.update({
    where: { id: tenantId },
    data: body,
    select: TENANT_SELECT,
  })
}
