import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store'
import DashboardLayout from '@/components/layout/DashboardLayout'

// Lazy-load every page — each gets its own chunk, loaded only when visited
const LandingPage      = lazy(() => import('@/pages/Landing'))
const DatasetsPage     = lazy(() => import('@/pages/Datasets'))
const EpisodesPage     = lazy(() => import('@/pages/Episodes'))
const EpisodeDetailPage = lazy(() => import('@/pages/EpisodeDetail'))
const QAPage           = lazy(() => import('@/pages/QA'))
const SimulatorPage    = lazy(() => import('@/pages/Simulator'))
const ActivityPage     = lazy(() => import('@/pages/Activity'))

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
      <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/app/datasets" replace />} />
          <Route path="datasets"    element={<Suspense fallback={<PageLoader />}><DatasetsPage /></Suspense>} />
          <Route path="episodes"    element={<Suspense fallback={<PageLoader />}><EpisodesPage /></Suspense>} />
          <Route path="episodes/:id" element={<Suspense fallback={<PageLoader />}><EpisodeDetailPage /></Suspense>} />
          <Route path="qa"          element={<Suspense fallback={<PageLoader />}><QAPage /></Suspense>} />
          <Route path="simulator"   element={<Suspense fallback={<PageLoader />}><SimulatorPage /></Suspense>} />
          <Route path="activity"    element={<Suspense fallback={<PageLoader />}><ActivityPage /></Suspense>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
