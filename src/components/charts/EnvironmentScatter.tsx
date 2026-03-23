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

interface EnvironmentScatterProps {
  areas: DerivedMicroArea[]
}

export const EnvironmentScatter = ({ areas }: EnvironmentScatterProps) => {
  const data = areas
    .filter((area) => area.annualPm25.value !== null && area.greenCoverPct.value !== null)
    .map((area) => ({
      x: area.annualPm25.value,
      y: area.greenCoverPct.value,
      station: area.stationName,
    }))

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" name="PM2.5" unit=" ug/m3" />
          <YAxis type="number" dataKey="y" name="Green cover" unit=" %" />
          <Tooltip />
          <Scatter data={data} fill="#0284c7" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
