import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, getTenantId, setTenantId } from './api'
import type { Tenant } from './types'

interface TenantContextValue {
  tenants: Tenant[]
  current: Tenant | null
  currentId: string | null
  setCurrent: (id: string) => void
  loading: boolean
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const [currentId, setCurrentId] = useState<string | null>(getTenantId())

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const res = await api.get<Tenant[]>('/api/tenants')
      return res.data
    },
  })

  // Default to the first tenant once the list loads, if none is selected.
  useEffect(() => {
    if (!currentId && tenants.length > 0) {
      setCurrentId(tenants[0].id)
      setTenantId(tenants[0].id)
    }
  }, [currentId, tenants])

  const setCurrent = (id: string) => {
    setTenantId(id)
    setCurrentId(id)
  }

  const value = useMemo<TenantContextValue>(
    () => ({
      tenants,
      current: tenants.find((t) => t.id === currentId) ?? null,
      currentId,
      setCurrent,
      loading: isLoading,
    }),
    [tenants, currentId, isLoading],
  )

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTenant() {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within TenantProvider')
  return ctx
}
