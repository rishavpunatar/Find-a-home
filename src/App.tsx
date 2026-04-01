import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/components/AppLayout'
import { LoadingState } from '@/components/LoadingState'

const RankedTablePage = lazy(() =>
  import('@/pages/RankedTablePage').then((module) => ({ default: module.RankedTablePage })),
)
const LondonWideRankedPage = lazy(() =>
  import('@/pages/LondonWideRankedPage').then((module) => ({
    default: module.LondonWideRankedPage,
  })),
)
const SummaryPage = lazy(() =>
  import('@/pages/SummaryPage').then((module) => ({ default: module.SummaryPage })),
)
const MicroAreaDetailPage = lazy(() =>
  import('@/pages/MicroAreaDetailPage').then((module) => ({
    default: module.MicroAreaDetailPage,
  })),
)

const NotFoundPage = () => (
  <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
    <p className="font-semibold">Page not found</p>
    <p className="mt-1">The requested route does not exist in this deployment.</p>
  </div>
)

const App = () => (
  <Suspense fallback={<LoadingState title="Loading view" />}>
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<SummaryPage />} />
        <Route path="filtered" element={<RankedTablePage />} />
        <Route path="trends" element={<LondonWideRankedPage />} />
        <Route path="micro-area/:microAreaId" element={<MicroAreaDetailPage />} />
        <Route path="summary" element={<Navigate to="/" replace />} />
        <Route path="ranked" element={<Navigate to="/filtered" replace />} />
        <Route path="ranked-london" element={<Navigate to="/trends" replace />} />
        <Route path="map" element={<Navigate to="/filtered" replace />} />
        <Route path="compare" element={<Navigate to="/filtered" replace />} />
        <Route path="home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  </Suspense>
)

export default App
