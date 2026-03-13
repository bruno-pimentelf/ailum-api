import { env } from '../config/env.js'

const BASE_URL =
  env.ASAAS_USE_SANDBOX || env.NODE_ENV !== 'production'
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3'

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

// ─── Finance / Listagens (para módulo financeiro) ─────────────────────────────

export interface AsaasCustomerListParams {
  offset?: number
  limit?: number
  name?: string
  email?: string
  cpfCnpj?: string
  externalReference?: string
}

export interface AsaasCustomerListResponse {
  object: string
  hasMore: boolean
  totalCount: number
  limit: number
  offset: number
  data: AsaasCustomerDetail[]
}

export interface AsaasCustomerDetail extends AsaasCustomer {
  dateCreated?: string
  mobilePhone?: string
  address?: string
  externalReference?: string | null
}

export interface AsaasPaymentListParams {
  offset?: number
  limit?: number
  customer?: string
  billingType?: string
  status?: string
  externalReference?: string
  dateCreated?: { ge?: string; le?: string }
  dueDate?: { ge?: string; le?: string }
  paymentDate?: { ge?: string; le?: string }
}

export interface AsaasPaymentListResponse {
  object: string
  hasMore: boolean
  totalCount: number
  limit: number
  offset: number
  data: AsaasPaymentDetail[]
}

export interface AsaasPaymentDetail {
  id: string
  dateCreated: string
  customer: string
  paymentLink?: string | null
  value: number
  netValue?: number
  billingType: string
  status: string
  dueDate: string
  paymentDate?: string | null
  description?: string | null
  externalReference?: string | null
  invoiceUrl?: string | null
  invoiceNumber?: string | null
}

export interface AsaasBalanceResponse {
  balance: number
}

export interface AsaasMunicipalOption {
  id: string
  code: string
  name: string
}

export interface AsaasInvoiceTaxes {
  retainIss: boolean
  iss: number
  pis: number
  cofins: number
  csll: number
  inss: number
  ir: number
  pisCofinsRetentionType?: string
  pisCofinsTaxStatus?: string
}

export interface AsaasInvoiceParams {
  payment: string
  serviceDescription: string
  observations: string
  value: number
  deductions?: number
  effectiveDate: string
  municipalServiceId?: string
  municipalServiceCode?: string
  municipalServiceName: string
  taxes: AsaasInvoiceTaxes
  externalReference?: string
  updatePayment?: boolean
}

export interface AsaasInvoiceResponse {
  id: string
  status: string
  customer?: string
  payment?: string
  value?: number
  pdfUrl?: string | null
  xmlUrl?: string | null
}

export function listCustomers(
  apiKey: string,
  params: AsaasCustomerListParams = {},
): Promise<AsaasCustomerListResponse> {
  const q = new URLSearchParams()
  if (params.offset != null) q.set('offset', String(params.offset))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.name) q.set('name', params.name)
  if (params.email) q.set('email', params.email)
  if (params.cpfCnpj) q.set('cpfCnpj', params.cpfCnpj)
  if (params.externalReference) q.set('externalReference', params.externalReference)
  return asaasFetch(apiKey, `/customers?${q}`)
}

export function listPayments(
  apiKey: string,
  params: AsaasPaymentListParams = {},
): Promise<AsaasPaymentListResponse> {
  const q = new URLSearchParams()
  if (params.offset != null) q.set('offset', String(params.offset))
  if (params.limit != null) q.set('limit', String(params.limit))
  if (params.customer) q.set('customer', params.customer)
  if (params.billingType) q.set('billingType', params.billingType)
  if (params.status) q.set('status', params.status)
  if (params.externalReference) q.set('externalReference', params.externalReference)
  if (params.dateCreated?.ge) q.set('dateCreated[ge]', params.dateCreated.ge)
  if (params.dateCreated?.le) q.set('dateCreated[le]', params.dateCreated.le)
  if (params.dueDate?.ge) q.set('dueDate[ge]', params.dueDate.ge)
  if (params.dueDate?.le) q.set('dueDate[le]', params.dueDate.le)
  if (params.paymentDate?.ge) q.set('paymentDate[ge]', params.paymentDate.ge)
  if (params.paymentDate?.le) q.set('paymentDate[le]', params.paymentDate.le)
  return asaasFetch(apiKey, `/payments?${q}`)
}

export function getFinanceBalance(apiKey: string): Promise<AsaasBalanceResponse> {
  return asaasFetch(apiKey, '/finance/balance')
}

export function listMunicipalOptions(
  apiKey: string,
): Promise<{ data: AsaasMunicipalOption[] }> {
  return asaasFetch(apiKey, '/fiscalInfo/municipalOptions')
}

export function scheduleInvoice(
  apiKey: string,
  params: AsaasInvoiceParams,
): Promise<AsaasInvoiceResponse> {
  return asaasFetch(apiKey, '/invoices', {
    method: 'POST',
    body: JSON.stringify({
      payment: params.payment,
      serviceDescription: params.serviceDescription,
      observations: params.observations,
      value: params.value,
      deductions: params.deductions ?? 0,
      effectiveDate: params.effectiveDate,
      municipalServiceId: params.municipalServiceId,
      municipalServiceCode: params.municipalServiceCode,
      municipalServiceName: params.municipalServiceName,
      taxes: {
        retainIss: params.taxes.retainIss,
        iss: params.taxes.iss,
        pis: params.taxes.pis,
        cofins: params.taxes.cofins,
        csll: params.taxes.csll,
        inss: params.taxes.inss,
        ir: params.taxes.ir,
        pisCofinsRetentionType: params.taxes.pisCofinsRetentionType ?? 'NOT_WITHHELD',
        pisCofinsTaxStatus: params.taxes.pisCofinsTaxStatus ?? 'STANDARD_TAXABLE_OPERATION',
      },
      externalReference: params.externalReference,
      updatePayment: params.updatePayment,
    }),
  })
}
