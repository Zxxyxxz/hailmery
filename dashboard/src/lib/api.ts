import axios, { type AxiosError } from 'axios'
import type { ApiError } from './types'

const TENANT_STORAGE_KEY = 'hm_tenant_id'
// Mirror of AUTH_STORAGE_KEY in auth-context.tsx — duplicated as a literal to
// avoid a circular import (auth-context already imports API_BASE_URL from here).
const AUTH_STORAGE_KEY = 'hm_auth_token'

/** The currently active tenant id is persisted so a reload keeps context. */
export function getTenantId(): string | null {
  return localStorage.getItem(TENANT_STORAGE_KEY)
}

export function setTenantId(id: string) {
  localStorage.setItem(TENANT_STORAGE_KEY, id)
}

// In dev, Vite proxies /api to the Worker on :8787 (see vite.config.ts), so the
// localhost base resolves same-origin through the proxy. In production the
// dashboard (Cloudflare Pages) and the Worker live on different origins, so the
// build is pointed at the deployed Worker URL via VITE_API_URL (.env.production).
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

export const api = axios.create({ baseURL: API_BASE_URL })

// Every request carries the active tenant in X-Tenant-ID; the Worker sets the
// app.tenant_id session var from it before any RLS-scoped query runs. It also
// carries the hailmery JWT (when signed in) as a Bearer token.
api.interceptors.request.use((config) => {
  const tenantId = getTenantId()
  if (tenantId) {
    config.headers.set('X-Tenant-ID', tenantId)
  }
  const token = sessionStorage.getItem(AUTH_STORAGE_KEY)
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

// A 401 means the token expired or was revoked — drop the session and bounce to
// the login gate. Guard on `had` so a stray 401 with no token can't loop reload.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      const had = sessionStorage.getItem(AUTH_STORAGE_KEY)
      sessionStorage.removeItem(AUTH_STORAGE_KEY)
      localStorage.removeItem(TENANT_STORAGE_KEY)
      if (had) window.location.reload()
    }
    return Promise.reject(error)
  },
)

/** Normalize an axios error into the backend's {error, code} shape. */
export function toApiError(err: unknown): ApiError {
  const ax = err as AxiosError<ApiError>
  if (ax?.response?.data?.error) return ax.response.data
  if (ax?.message) return { error: ax.message, code: 'network_error' }
  return { error: 'Unknown error', code: 'unknown' }
}
