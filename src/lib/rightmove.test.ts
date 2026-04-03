import { describe, expect, it } from 'vitest'

import { buildRightmoveAreaUrl } from './rightmove'

describe('buildRightmoveAreaUrl', () => {
  it('builds a Rightmove houses search for a station area', () => {
    const url = new URL(buildRightmoveAreaUrl({ stationName: 'Elstree & Borehamwood' }))

    expect(url.origin).toBe('https://www.rightmove.co.uk')
    expect(url.pathname).toBe('/property-for-sale/search.html')
    expect(url.searchParams.get('searchLocation')).toBe('Elstree & Borehamwood')
    expect(url.searchParams.get('useLocationIdentifier')).toBe('false')
    expect(url.searchParams.get('locationIdentifier')).toBe('')
    expect(url.searchParams.get('propertyTypes')).toBe('detached,semi-detached,terraced,bungalow')
    expect(url.searchParams.get('includeSSTC')).toBe('false')
  })
})
