import {
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

import { getAreaPropertyEvidenceLabel } from '@/lib/dataQuality'

import { computeNumericDomain } from './chartUtils'

interface OverallConfidenceEvidenceScatterProps {
  areas: DerivedMicroArea[]
}

type EvidenceGroup = 'Current listings' | 'Sold-price fallback' | 'Modelled or other'

const evidenceColors: Record<EvidenceGroup, string> = {
  'Current listings': '#0f766e',
  'Sold-price fallback': '#0284c7',
  'Modelled or other': '#f59e0b',
}

const getEvidenceGroup = (area: DerivedMicroArea): EvidenceGroup => {
  const provenance = area.medianSemiDetachedPrice.provenance
  if (provenance === 'direct_listing' || provenance === 'direct_listing_extended') {
    return 'Current listings'
  }
  if (provenance === 'direct_transactions' || provenance === 'direct_transactions_extended') {
    return 'Sold-price fallback'
  }
  return 'Modelled or other'
}

export const OverallConfidenceEvidenceScatter = ({
  areas,
}: OverallConfidenceEvidenceScatterProps) => {
  const data = areas.map((area) => ({
    x: area.dataConfidenceScore * 100,
    y: area.dynamicOverallScore,
    station: area.stationName,
    evidenceGroup: getEvidenceGroup(area),
    evidenceLabel: getAreaPropertyEvidenceLabel(area),
  }))

  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0, maxCeil: 100 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0, maxCeil: 100 })

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="Confidence" unit=" %" domain={xDomain} />
          <YAxis type="number" dataKey="y" name="Overall score" domain={yDomain} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as
                | { station: string; x: number; y: number; evidenceGroup: string; evidenceLabel: string }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">Confidence: {point.x.toFixed(0)}%</p>
                  <p className="text-slate-700">Overall score: {point.y.toFixed(1)}</p>
                  <p className="text-slate-700">Property evidence: {point.evidenceLabel}</p>
                </div>
              )
            }}
          />
          <Legend />
          {(Object.keys(evidenceColors) as EvidenceGroup[]).map((group) => (
            <Scatter
              key={group}
              name={group}
              data={data.filter((item) => item.evidenceGroup === group)}
              fill={evidenceColors[group]}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
