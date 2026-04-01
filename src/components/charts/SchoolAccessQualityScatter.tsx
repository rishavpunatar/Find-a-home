import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { DerivedMicroArea } from '@/types/domain'

import { computeNumericDomain } from './chartUtils'

interface SchoolAccessQualityScatterProps {
  areas: DerivedMicroArea[]
}

export const SchoolAccessQualityScatter = ({ areas }: SchoolAccessQualityScatterProps) => {
  const data = areas
    .map((area) => {
      const primaryCount = area.nearbyPrimaryCount.value
      const secondaryCount = area.nearbySecondaryCount.value
      const primaryQuality = area.primaryQualityScore.value
      const secondaryQuality = area.secondaryQualityScore.value

      if (
        primaryCount === null ||
        secondaryCount === null ||
        primaryQuality === null ||
        secondaryQuality === null
      ) {
        return null
      }

      return {
        x: primaryCount + secondaryCount,
        y: (primaryQuality + secondaryQuality) / 2,
        station: area.stationName,
        primaryCount,
        secondaryCount,
        primaryQuality,
        secondaryQuality,
      }
    })
    .filter(
      (
        item,
      ): item is {
        x: number
        y: number
        station: string
        primaryCount: number
        secondaryCount: number
        primaryQuality: number
        secondaryQuality: number
      } => item !== null,
    )

  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0, maxCeil: 100 })

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="School access count" domain={xDomain} />
          <YAxis type="number" dataKey="y" name="Average school quality" domain={yDomain} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) {
                return null
              }
              const point = payload[0]?.payload as
                | {
                    station: string
                    x: number
                    y: number
                    primaryCount: number
                    secondaryCount: number
                    primaryQuality: number
                    secondaryQuality: number
                  }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">Total school access: {Math.round(point.x)}</p>
                  <p className="text-slate-700">Average quality: {point.y.toFixed(1)}</p>
                  <p className="text-slate-700">
                    Primary: {Math.round(point.primaryCount)} schools at {point.primaryQuality.toFixed(1)}
                  </p>
                  <p className="text-slate-700">
                    Secondary: {Math.round(point.secondaryCount)} schools at {point.secondaryQuality.toFixed(1)}
                  </p>
                </div>
              )
            }}
          />
          <Scatter data={data} fill="#7c3aed" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
