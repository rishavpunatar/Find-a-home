import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve('data/processed')
const destination = resolve('public/data/processed')

const copyData = async () => {
  await mkdir(destination, { recursive: true })

  if (!existsSync(source)) {
    console.warn('[sync:data] No data/processed directory found; skipping copy.')
    return
  }

  await cp(source, destination, { recursive: true, force: true })
  console.info('[sync:data] Copied processed datasets to public/data/processed')
}

await copyData()
