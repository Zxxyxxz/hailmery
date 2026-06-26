import { NavLink } from 'react-router-dom'
import {
  Inbox,
  Calendar as CalendarIcon,
  Megaphone,
  BarChart3,
  Settings as SettingsIcon,
  ChevronsUpDown,
  Check,
  LogOut,
} from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { useAuth } from '@/lib/auth-context'
import { Popover } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/queue', label: 'Queue', icon: Inbox },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function Logo() {
  return (
    <div className="flex items-center gap-3 px-3 py-5">
      <div className="relative h-9 w-9">
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 opacity-90" />
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 opacity-40 blur-lg" />
        <div className="relative flex h-full w-full items-center justify-center text-sm font-extrabold text-white">
          hm
        </div>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-base font-bold text-white">hailmery</span>
        <span className="text-[10px] uppercase tracking-wider text-[#64748b]">
          Command Center
        </span>
      </div>
    </div>
  )
}

function TenantSwitcher() {
  const { tenants, current, setCurrent } = useTenant()
  return (
    <Popover
      align="start"
      className="bottom-full left-0 mb-2 mt-0 w-56"
      trigger={
        <button className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#1e1e2e] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-xs font-bold text-white">
              {current?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="overflow-hidden">
              <div className="truncate text-sm font-medium text-gray-200">
                {current?.name ?? 'Select tenant'}
              </div>
              <div className="truncate text-[11px] text-[#64748b]">
                {current?.slug ?? '—'}
              </div>
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-[#64748b]" />
        </button>
      }
    >
      {({ close }) => (
        <div className="space-y-0.5">
          <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-[#64748b]">
            Switch tenant
          </div>
          {tenants.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setCurrent(t.id)
                close()
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm text-gray-300 transition-colors hover:bg-white/[0.06]"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.06] text-[11px] font-bold text-gray-300">
                  {t.name[0]?.toUpperCase()}
                </span>
                {t.name}
              </span>
              {current?.id === t.id && (
                <Check className="h-4 w-4 text-violet-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

/**
 * App sidebar. On desktop (≥768px) it's a fixed-in-flow 256px rail. On mobile it
 * becomes an off-canvas drawer driven by `open`/`onClose` from AppLayout, sliding
 * in over a dimmed overlay; tapping a nav item closes it.
 */
export function Sidebar({
  open = false,
  onClose,
}: {
  open?: boolean
  onClose?: () => void
}) {
  const { user, logout } = useAuth()
  return (
    <aside
      id="app-sidebar"
      aria-label="Main navigation"
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r border-[#1e1e2e] bg-[#0a0a0f] transition-transform duration-200 ease-out',
        'md:sticky md:top-0 md:z-auto md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <Logo />
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-violet-500/15 text-violet-300 shadow-sm shadow-violet-500/10'
                  : 'text-[#94a3b8] hover:bg-white/[0.05] hover:text-[#f1f5f9]',
              )
            }
          >
            <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-2 border-t border-[#1e1e2e] p-3">
        <TenantSwitcher />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="truncate text-[11px] text-[#64748b]" title={user?.email}>
            {user?.email}
          </span>
          <button
            onClick={logout}
            className="flex shrink-0 items-center gap-1 text-[11px] text-[#94a3b8] transition-colors hover:text-[#ef4444]"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
