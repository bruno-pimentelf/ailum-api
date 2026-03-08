import { env } from '../config/env.js'

const BASE_URL =
  env.NODE_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3'

// ─── Response types ───────────────────────────────────────────────────────────

export interface AsaasCustomer {
  id: string
  name: string
  cpfCnpj: string | null
  email: string | null
  phone: string | null
}

export interface AsaasPayment {
  id: string
  status: string
  value: number
  dueDate: string
  description: string
  billingType: string
  externalReference: string | null
}

export interface AsaasPixResponse {
  id: string
  status: string
  encodedImage: string
  payload: string
  expirationDate: string
}

export interface AsaasError {
  status: number
  message: string
}

// ─── Typed request error ──────────────────────────────────────────────────────

export class AsaasApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'AsaasApiError'
  }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function asaasFetch<T>(
  apiKey: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await globalThis.fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey,
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new AsaasApiError(
      response.status,
      `Asaas API ${response.status} on ${path}: ${body}`,
    )
  }

  if (response.status === 204) return undefined as unknown as T
  return response.json() as Promise<T>
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export async function createCustomer(
  apiKey: string,
  params: { name: string; cpfCnpj?: string; email?: string; phone?: string },
): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>(apiKey, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      cpfCnpj: params.cpfCnpj,
      email: params.email,
      mobilePhone: params.phone,
    }),
  })
}

export async function findOrCreateCustomer(
  apiKey: string,
  params: { name: string; cpfCnpj?: string; email?: string; phone?: string; externalReference: string },
): Promise<AsaasCustomer> {
  // Try to find by externalReference first
  const searchResult = await asaasFetch<{ data: AsaasCustomer[] }>(
    apiKey,
    `/customers?externalReference=${encodeURIComponent(params.externalReference)}`,
  )

  if (searchResult.data.length > 0) {
    return searchResult.data[0]!
  }

  return createCustomer(apiKey, { ...params })
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function createPixCharge(
  apiKey: string,
  params: {
    contactName: string
    cpfCnpj?: string
    email?: string
    phone?: string
    value: number
    description: string
    dueDate: string
    externalReference?: string
  },
): Promise<AsaasPixResponse> {
  // 1. Find or create Asaas customer
  const customer = await findOrCreateCustomer(apiKey, {
    name: params.contactName,
    cpfCnpj: params.cpfCnpj,
    email: params.email,
    phone: params.phone,
    externalReference: params.externalReference ?? params.contactName,
  })

  // 2. Create PIX payment
  const payment = await asaasFetch<AsaasPayment>(apiKey, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: customer.id,
      billingType: 'PIX',
      value: params.value,
      dueDate: params.dueDate,
      description: params.description,
      externalReference: params.externalReference,
    }),
  })

  // 3. Fetch PIX QR code
  const pix = await asaasFetch<AsaasPixResponse>(
    apiKey,
    `/payments/${payment.id}/pixQrCode`,
  )

  return {
    id: payment.id,
    status: payment.status,
    encodedImage: pix.encodedImage,
    payload: pix.payload,
    expirationDate: pix.expirationDate,
  }
}

export async function getPaymentStatus(
  apiKey: string,
  paymentId: string,
): Promise<string> {
  const payment = await asaasFetch<AsaasPayment>(apiKey, `/payments/${paymentId}`)
  return payment.status
}

export async function cancelPayment(
  apiKey: string,
  paymentId: string,
): Promise<void> {
  await asaasFetch<void>(apiKey, `/payments/${paymentId}`, { method: 'DELETE' })
}
