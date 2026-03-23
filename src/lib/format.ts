export const formatNumber = (value: number | null, fractionDigits = 0): string => {
  if (value === null || Number.isNaN(value)) {
    return 'N/A'
  }

  return new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value)
}

export const formatPercent = (value: number | null): string =>
  value === null ? 'N/A' : `${value.toFixed(1)}%`

export const formatCurrency = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return 'N/A'
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value)
}

export const formatDate = (isoDate: string): string => {
  const date = new Date(isoDate)

  if (Number.isNaN(date.getTime())) {
    return isoDate
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
  }).format(date)
}
