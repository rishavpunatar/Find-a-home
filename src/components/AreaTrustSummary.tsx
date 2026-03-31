import type { MicroArea } from '@/types/domain'

import { getAreaDomainStatusCounts, getAreaTrustTier, type TrustTier } from '@/lib/dataQuality'

const trustTierStyles: Record<TrustTier, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low: 'border-rose-200 bg-rose-50 text-rose-800',
}

const trustTierLabels: Record<TrustTier, string> = {
  high: 'High confidence',
  medium: 'Moderate confidence',
  low: 'Low confidence',
}

interface AreaTrustSummaryProps {
  area: MicroArea
  compact?: boolean
}

export const AreaTrustSummary = ({
  area,
  compact = false,
}: AreaTrustSummaryProps) => {
  const trustTier = getAreaTrustTier(area)
  const counts = getAreaDomainStatusCounts(area)

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${trustTierStyles[trustTier]}`}
      >
        {trustTierLabels[trustTier]}
      </span>
      <span className="text-slate-500">
        Domains: {counts.available} avail · {counts.estimated} est
        {counts.placeholder > 0 ? ` · ${counts.placeholder} placeholder` : ''}
        {counts.missing > 0 ? ` · ${counts.missing} missing` : ''}
      </span>
    </div>
  )
}
