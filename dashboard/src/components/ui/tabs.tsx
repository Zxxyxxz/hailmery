import {
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

interface TabsContextValue {
  value: string
  setValue: (v: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string
  onValueChange: (v: string) => void
  children: ReactNode
  className?: string
}) {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

export function TabsList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-[#1e1e2e] bg-white/[0.03] p-1',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function TabsTrigger({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('TabsTrigger must be used within Tabs')
  const active = ctx.value === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setValue(value)}
      className={cn(
        'rounded-lg px-3.5 py-1.5 text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
        active
          ? 'bg-violet-500/15 text-violet-300 shadow-sm shadow-violet-500/10'
          : 'text-[#94a3b8] hover:bg-white/[0.04] hover:text-[#f1f5f9]',
      )}
    >
      {children}
    </button>
  )
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('TabsContent must be used within Tabs')
  if (ctx.value !== value) return null
  return (
    <div role="tabpanel" tabIndex={0} className={cn('animate-fade-in focus:outline-none', className)}>
      {children}
    </div>
  )
}
