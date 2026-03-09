import type { MemberRole } from '../generated/prisma/client.js'

export const PERMISSIONS = {
  // Contacts
  CONTACTS_READ: 'contacts:read',
  CONTACTS_WRITE: 'contacts:write',
  CONTACTS_DELETE: 'contacts:delete',

  // Scheduling
  SCHEDULING_READ: 'scheduling:read',
  SCHEDULING_WRITE: 'scheduling:write',
  SCHEDULING_DELETE: 'scheduling:delete',
  SCHEDULING_READ_OWN: 'scheduling:read_own',
  SCHEDULING_WRITE_OWN: 'scheduling:write_own',

  // Billing
  BILLING_READ: 'billing:read',
  BILLING_WRITE: 'billing:write',

  // Funnels & Stages
  FUNNELS_READ: 'funnels:read',
  FUNNELS_WRITE: 'funnels:write',

  // Professionals
  PROFESSIONALS_READ: 'professionals:read',
  PROFESSIONALS_WRITE: 'professionals:write',
  PROFESSIONALS_WRITE_OWN: 'professionals:write_own',

  // Services
  SERVICES_READ: 'services:read',
  SERVICES_WRITE: 'services:write',

  // Members
  MEMBERS_READ: 'members:read',
  MEMBERS_WRITE: 'members:write',
  MEMBERS_INVITE: 'members:invite',

  // Voices
  VOICES_READ: 'voices:read',
  VOICES_WRITE: 'voices:write',

  // Agent / AI config
  AGENT_CONFIG_READ: 'agent_config:read',
  AGENT_CONFIG_WRITE: 'agent_config:write',

  // Tenant settings
  TENANT_SETTINGS_READ: 'tenant:settings_read',
  TENANT_SETTINGS_WRITE: 'tenant:settings_write',
  TENANT_INTEGRATIONS_WRITE: 'tenant:integrations_write',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  ADMIN: Object.values(PERMISSIONS) as Permission[],

  PROFESSIONAL: [
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.SCHEDULING_READ_OWN,
    PERMISSIONS.SCHEDULING_WRITE_OWN,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.FUNNELS_READ,
    PERMISSIONS.PROFESSIONALS_READ,
    PERMISSIONS.PROFESSIONALS_WRITE_OWN,
    PERMISSIONS.SERVICES_READ,
  ],

  SECRETARY: [
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    PERMISSIONS.SCHEDULING_READ,
    PERMISSIONS.SCHEDULING_WRITE,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.BILLING_WRITE,
    PERMISSIONS.FUNNELS_READ,
    PERMISSIONS.PROFESSIONALS_READ,
    PERMISSIONS.SERVICES_READ,
    PERMISSIONS.MEMBERS_READ,
  ],
}
