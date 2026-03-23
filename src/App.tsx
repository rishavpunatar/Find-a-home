import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from '@/components/AppLayout'
import { ComparisonPage } from '@/pages/ComparisonPage'
import { MapPage } from '@/pages/MapPage'
import { MicroAreaDetailPage } from '@/pages/MicroAreaDetailPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { RankedTablePage } from '@/pages/RankedTablePage'

const NotFoundPage = () => (
  <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
    <p className="font-semibold">Page not found</p>
    <p className="mt-1">The requested route does not exist in this deployment.</p>
  </div>
)

const App = () => (
  <Routes>
    <Route path="/" element={<AppLayout />}>
      <Route index element={<OverviewPage />} />
      <Route path="ranked" element={<RankedTablePage />} />
      <Route path="map" element={<MapPage />} />
      <Route path="compare" element={<ComparisonPage />} />
      <Route path="micro-area/:microAreaId" element={<MicroAreaDetailPage />} />
      <Route path="home" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>
)

export default App
