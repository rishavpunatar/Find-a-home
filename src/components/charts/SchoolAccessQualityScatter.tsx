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

import { totalSchoolAccessPerPopulation } from '@/lib/schoolAccess'

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
      const populationDenominator = area.populationDenominator ?? null

      if (
        primaryCount === null ||
        secondaryCount === null ||
        primaryQuality === null ||
        secondaryQuality === null
      ) {
        return null
      }

      const populationAdjustedAccess = totalSchoolAccessPerPopulation(
        primaryCount,
        secondaryCount,
        populationDenominator,
      )

      if (populationAdjustedAccess === null) {
        return null
      }

      return {
        x: populationAdjustedAccess,
        y: (primaryQuality + secondaryQuality) / 2,
        station: area.stationName,
        primaryCount,
        secondaryCount,
        primaryQuality,
        secondaryQuality,
        populationDenominator,
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
        populationDenominator: number | null
      } => item !== null,
    )

  const xDomain = computeNumericDomain(data.map((item) => item.x), { minFloor: 0 })
  const yDomain = computeNumericDomain(data.map((item) => item.y), { minFloor: 0, maxCeil: 100 })

  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 24, bottom: 26, left: 12 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="School access per 10,000 residents" domain={xDomain} />
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
                    populationDenominator: number | null
                  }
                | undefined
              if (!point) {
                return null
              }
              return (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                  <p className="font-semibold text-slate-900">{point.station}</p>
                  <p className="text-slate-700">
                    School access: {point.x.toFixed(1)} per 10,000 residents
                  </p>
                  <p className="text-slate-700">Average quality: {point.y.toFixed(1)}</p>
                  <p className="text-slate-700">
                    Primary: {Math.round(point.primaryCount)} schools at {point.primaryQuality.toFixed(1)}
                  </p>
                  <p className="text-slate-700">
                    Secondary: {Math.round(point.secondaryCount)} schools at {point.secondaryQuality.toFixed(1)}
                  </p>
                  {point.populationDenominator !== null ? (
                    <p className="text-slate-700">
                      Population denominator: {Math.round(point.populationDenominator).toLocaleString('en-GB')}
                    </p>
                  ) : null}
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
