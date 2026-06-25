import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Escape closes the mobile drawer (the overlay only closes on click).
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  return (
    <div className="flex min-h-screen bg-[#000000]">
      {/* Mobile drawer overlay — tap to dismiss */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar with hamburger — hidden on desktop */}
        <div className="flex items-center gap-3 border-b border-[#1e1e2e] p-4 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            className="rounded-lg p-1 text-[#94a3b8] transition-colors hover:bg-white/[0.06] hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-white">hailmery</span>
        </div>

        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
