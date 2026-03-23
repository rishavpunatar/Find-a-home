import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import type { ProcessedDataset } from '@/types/domain'

interface DataState {
  dataset: ProcessedDataset | null
  loading: boolean
  error: string | null
}

const DataContext = createContext<DataState | null>(null)

const DATASET_PATH = `${import.meta.env.BASE_URL}data/processed/micro_areas.json`

export const DataProvider = ({ children }: { children: React.ReactNode }) => {
  const [dataset, setDataset] = useState<ProcessedDataset | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(DATASET_PATH)

        if (!response.ok) {
          throw new Error(`Failed to load dataset (${response.status})`)
        }

        const json = (await response.json()) as ProcessedDataset
        setDataset(json)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown dataset error'
        setError(message)
      } finally {
        setLoading(false)
      }
    }

    void loadData()
  }, [])

  const value = useMemo(
    () => ({
      dataset,
      loading,
      error,
    }),
    [dataset, error, loading],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useDataContext = (): DataState => {
  const value = useContext(DataContext)

  if (!value) {
    throw new Error('useDataContext must be used inside DataProvider')
  }

  return value
}
