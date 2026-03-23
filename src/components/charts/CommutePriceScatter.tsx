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

interface CommutePriceScatterProps {
  areas: DerivedMicroArea[]
}

export const CommutePriceScatter = ({ areas }: CommutePriceScatterProps) => {
  const data = areas
    .filter(
      (area) =>
        area.commuteTypicalMinutes.value !== null && area.medianSemiDetachedPrice.value !== null,
    )
    .map((area) => ({
      x: area.commuteTypicalMinutes.value,
      y: area.medianSemiDetachedPrice.value,
      z: area.dynamicOverallScore,
      station: area.stationName,
    }))

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="Commute" unit=" min" />
          <YAxis type="number" dataKey="y" name="Median price" unit=" GBP" width={85} />
          <Tooltip />
          <Scatter data={data} fill="#0f766e" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
