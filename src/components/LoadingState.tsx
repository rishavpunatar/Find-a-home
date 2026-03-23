interface LoadingStateProps {
  title: string
  detail?: string
}

export const LoadingState = ({ title, detail }: LoadingStateProps) => (
  <div className="rounded-xl border border-teal-100 bg-white p-6 text-sm text-slate-700 shadow-panel">
    <p className="font-semibold">{title}</p>
    {detail ? <p className="mt-1 text-slate-600">{detail}</p> : null}
  </div>
)
