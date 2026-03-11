import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'

const ClinicSlugParamsSchema = Type.Object({ slug: Type.String({ minLength: 1 }) })

export async function publicRoutes(fastify: FastifyInstance) {
  // GET /v1/public/clinics/:slug — perfil público da clínica (sem auth)
  fastify.get<{ Params: { slug: string } }>('/clinics/:slug', {
    schema: {
      params: ClinicSlugParamsSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: ['string', 'null'] },
            logoUrl: { type: ['string', 'null'] },
            phone: { type: ['string', 'null'] },
            email: { type: ['string', 'null'] },
            website: { type: ['string', 'null'] },
            address: { type: ['object', 'null'] },
            services: { type: 'array' },
            professionals: { type: 'array' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { slug } = req.params

    const tenant = await fastify.db.tenant.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logoUrl: true,
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
      },
    })

    if (!tenant) {
      return reply.status(404).send({ error: 'Clínica não encontrada' })
    }

    const [services, professionals] = await Promise.all([
      fastify.db.service.findMany({
        where: { tenantId: tenant.id, isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          durationMin: true,
          price: true,
          isConsultation: true,
          professionalServices: {
            where: { professional: { isActive: true } },
            select: {
              professional: {
                select: { id: true, fullName: true, specialty: true, avatarUrl: true },
              },
            },
          },
        },
      }),
      fastify.db.professional.findMany({
        where: { tenantId: tenant.id, isActive: true },
        orderBy: { fullName: 'asc' },
        select: {
          id: true,
          fullName: true,
          specialty: true,
          bio: true,
          avatarUrl: true,
          professionalServices: {
            select: { service: { select: { id: true, name: true } } },
          },
        },
      }),
    ])

    const address =
      tenant.addressStreet || tenant.addressCity
        ? {
            street: tenant.addressStreet,
            number: tenant.addressNumber,
            complement: tenant.addressComplement,
            neighborhood: tenant.addressNeighborhood,
            city: tenant.addressCity,
            state: tenant.addressState,
            zip: tenant.addressZip,
          }
        : null

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      description: tenant.description,
      logoUrl: tenant.logoUrl,
      phone: tenant.phone,
      email: tenant.email,
      website: tenant.website,
      address,
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        durationMin: s.durationMin,
        price: Number(s.price),
        isConsultation: s.isConsultation,
        professionals: s.professionalServices.map((ps) => ({
          id: ps.professional.id,
          fullName: ps.professional.fullName,
          specialty: ps.professional.specialty,
          avatarUrl: ps.professional.avatarUrl,
        })),
      })),
      professionals: professionals.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        specialty: p.specialty,
        bio: p.bio,
        avatarUrl: p.avatarUrl,
        services: p.professionalServices.map((ps) => ({
          id: ps.service.id,
          name: ps.service.name,
        })),
      })),
    }
  })
}
