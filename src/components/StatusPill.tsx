import type { MetricStatus } from '@/types/domain'

const styleMap: Record<MetricStatus, string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  estimated: 'bg-amber-50 text-amber-700 border-amber-100',
  placeholder: 'bg-slate-100 text-slate-700 border-slate-200',
  missing: 'bg-red-50 text-red-700 border-red-100',
}

export const StatusPill = ({ status }: { status: MetricStatus }) => (
  <span
    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${styleMap[status]}`}
  >
    {status}
  </span>
)
