interface ErrorStateProps {
  title: string
  detail: string
}

export const ErrorState = ({ title, detail }: ErrorStateProps) => (
  <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
    <p className="font-semibold">{title}</p>
    <p className="mt-1">{detail}</p>
  </div>
)
