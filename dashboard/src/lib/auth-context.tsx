import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL } from './api'

interface AuthUser {
  email: string
  name: string | null
  allowedTenants: string[]
  token: string
}

interface AuthContextValue {
  user: AuthUser | null
  login: () => void // opens the Google OAuth popup
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Token lives in sessionStorage (cleared when the tab closes) — the axios
// interceptor in ./api reads this exact key on every request. The active tenant
// lives in localStorage under hm_tenant_id; logout clears both.
export const AUTH_STORAGE_KEY = 'hm_auth_token'
const TENANT_STORAGE_KEY = 'hm_tenant_id'

function parseJwtPayload(token: string): Omit<AuthUser, 'token'> | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as {
      email?: string
      name?: string | null
      allowedTenants?: string[]
      exp?: number
    }
    // Reject an expired token client-side so we don't flash the app before the
    // first 401 bounces us back to login.
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    if (!payload.email) return null
    return {
      email: payload.email,
      name: payload.name ?? null,
      allowedTenants: payload.allowedTenants ?? [],
    }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const queryClient = useQueryClient()

  // Restore session from sessionStorage on mount.
  useEffect(() => {
    const stored = sessionStorage.getItem(AUTH_STORAGE_KEY)
    if (stored) {
      const payload = parseJwtPayload(stored)
      if (payload) {
        setUser({ ...payload, token: stored })
      } else {
        sessionStorage.removeItem(AUTH_STORAGE_KEY) // expired / malformed
      }
    }
    setIsLoading(false)
  }, [])

  function login() {
    const popup = window.open(
      `${API_BASE_URL}/api/auth/login/google/start`,
      'hailmery-login',
      'width=500,height=600,left=200,top=100',
    )
    if (!popup) {
      alert(
        'Your browser blocked the login window. Please allow pop-ups for this site and try again.',
      )
      return
    }

    let poll: ReturnType<typeof setInterval> | undefined
    function cleanup() {
      window.removeEventListener('message', handleMessage)
      if (poll) clearInterval(poll)
    }

    function handleMessage(event: MessageEvent) {
      // Only trust messages from the Worker origin that served the login popup.
      if (event.origin !== new URL(API_BASE_URL).origin) return
      if (event.data?.type !== 'hailmery-login') return
      cleanup()
      popup?.close()

      if (event.data.error) {
        console.error('[auth] Login failed:', event.data.error)
        if (event.data.error === 'not_authorized') {
          alert(
            `Access denied: ${event.data.email ?? 'that account'} is not authorized for hailmery. Contact your administrator.`,
          )
        } else if (event.data.error === 'email_unverified') {
          alert('Login failed: your Google account email is not verified.')
        } else {
          alert('Login failed. Please try again.')
        }
        return
      }

      const { token } = event.data as { token?: string }
      const payload = token ? parseJwtPayload(token) : null
      if (!token || !payload) {
        alert('Login failed: invalid token received.')
        return
      }
      sessionStorage.setItem(AUTH_STORAGE_KEY, token)
      setUser({ ...payload, token })
    }

    window.addEventListener('message', handleMessage)
    // If the user closes the popup without finishing, stop listening so handlers
    // don't accumulate across repeated attempts.
    poll = setInterval(() => {
      if (popup.closed) cleanup()
    }, 600)
  }

  function logout() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(TENANT_STORAGE_KEY) // drop tenant selection too
    queryClient.clear() // wipe cached tenant/draft data so the next user starts clean
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
