import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { TenantProvider } from '@/lib/tenant-context'
import { useAuth } from '@/lib/auth-context'
import { LoginPage } from '@/pages/LoginPage'
import Queue from '@/pages/Queue'
import CalendarPage from '@/pages/CalendarPage'
import Campaigns from '@/pages/Campaigns'
import SettingsPage from '@/pages/SettingsPage'
import Analytics from '@/pages/Analytics'
import BlogManagement from '@/pages/BlogManagement'

export default function App() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-sm text-[#64748b]">Loading…</div>
      </div>
    )
  }

  // Not signed in → login gate. TenantProvider (which fetches /api/tenants) is
  // mounted ONLY past this point, so an unauthenticated load never fires a 401.
  if (!user) return <LoginPage />

  return (
    <TenantProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/queue" replace />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/blog" element={<BlogManagement />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/queue" replace />} />
        </Route>
      </Routes>
    </TenantProvider>
  )
}
