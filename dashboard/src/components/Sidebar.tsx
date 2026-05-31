import { NavLink } from 'react-router-dom'
import {
  Inbox,
  Calendar as CalendarIcon,
  Megaphone,
  BarChart3,
  Settings as SettingsIcon,
  ChevronsUpDown,
  Check,
} from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
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
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 opacity-80" />
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 opacity-30 blur-lg" />
        <div className="relative flex h-full w-full items-center justify-center text-sm font-extrabold text-white">
          hm
        </div>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-base font-bold text-white">hailmery</span>
        <span className="text-[10px] uppercase tracking-wider text-gray-500">
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
        <button className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
              {current?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="overflow-hidden">
              <div className="truncate text-sm font-medium text-gray-200">
                {current?.name ?? 'Select tenant'}
              </div>
              <div className="truncate text-[11px] text-gray-500">
                {current?.slug ?? '—'}
              </div>
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-500" />
        </button>
      }
    >
      {({ close }) => (
        <div className="space-y-0.5">
          <div className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-600">
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
                <Check className="h-4 w-4 text-cyan-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

export function Sidebar() {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0d12]">
      <Logo />
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-cyan-500/15 text-cyan-300 shadow-sm shadow-cyan-500/10'
                  : 'text-gray-400 hover:bg-white/[0.05] hover:text-gray-200',
              )
            }
          >
            <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/[0.06] p-3">
        <TenantSwitcher />
      </div>
    </aside>
  )
}
