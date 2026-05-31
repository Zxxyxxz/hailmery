import axios, { type AxiosError } from 'axios'
import type { ApiError } from './types'

const TENANT_STORAGE_KEY = 'hm_tenant_id'

/** The currently active tenant id is persisted so a reload keeps context. */
export function getTenantId(): string | null {
  return localStorage.getItem(TENANT_STORAGE_KEY)
}

export function setTenantId(id: string) {
  localStorage.setItem(TENANT_STORAGE_KEY, id)
}

// Base URL is empty in dev — Vite proxies /api to the Worker on :8787.
export const api = axios.create({ baseURL: '' })

// Every request carries the active tenant in X-Tenant-ID; the Worker sets the
// app.tenant_id session var from it before any RLS-scoped query runs.
api.interceptors.request.use((config) => {
  const tenantId = getTenantId()
  if (tenantId) {
    config.headers.set('X-Tenant-ID', tenantId)
  }
  return config
})

/** Normalize an axios error into the backend's {error, code} shape. */
export function toApiError(err: unknown): ApiError {
  const ax = err as AxiosError<ApiError>
  if (ax?.response?.data?.error) return ax.response.data
  if (ax?.message) return { error: ax.message, code: 'network_error' }
  return { error: 'Unknown error', code: 'unknown' }
}
