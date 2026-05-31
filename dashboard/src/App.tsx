import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import Queue from '@/pages/Queue'
import CalendarPage from '@/pages/CalendarPage'
import Campaigns from '@/pages/Campaigns'
import SettingsPage from '@/pages/SettingsPage'
import Analytics from '@/pages/Analytics'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="/queue" element={<Queue />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  )
}
