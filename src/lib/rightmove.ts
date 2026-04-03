import type { MicroArea } from '@/types/domain'

const RIGHTMOVE_HOUSE_TYPES = ['detached', 'semi-detached', 'terraced', 'bungalow'] as const

export const buildRightmoveAreaUrl = (area: Pick<MicroArea, 'stationName'>): string => {
  const url = new URL('https://www.rightmove.co.uk/property-for-sale/search.html')

  url.searchParams.set('searchLocation', area.stationName)
  url.searchParams.set('useLocationIdentifier', 'false')
  url.searchParams.set('locationIdentifier', '')
  url.searchParams.set('propertyTypes', RIGHTMOVE_HOUSE_TYPES.join(','))
  url.searchParams.set('includeSSTC', 'false')

  return url.toString()
}
