import type { Weights } from '@/types/domain'

export type RankingAxisKey = keyof Weights

export interface RankingAxisDefinition {
  key: RankingAxisKey
  label: string
  rankingExplanationLabel: string
  mapLabel: string
  distributionTitle: string
  distributionDescription: string
  chartColor: string
  detail: string
  recipe: string
  formula: string
}

export const rankingAxes: RankingAxisDefinition[] = [
  {
    key: 'transport',
    label: 'Transport',
    rankingExplanationLabel: 'transport',
    mapLabel: 'Transport score',
    distributionTitle: 'Transport score',
    distributionDescription:
      'How varied the commute and transport axis is across the full set.',
    chartColor: '#0284c7',
    detail:
      'A higher transport score means the area has a better commute into the central London core, better peak service, fewer changes, or some combination of those.',
    recipe:
      'This combines four transformed transport inputs: typical commute, peak commute, peak trains-per-hour, and interchange count. Shorter journeys and fewer changes help; stronger service frequency helps.',
    formula:
      'Transport score = typical commute 30% + peak commute 20% + peak service 30% + interchange score 20%',
  },
  {
    key: 'schools',
    label: 'Schools',
    rankingExplanationLabel: 'schools',
    mapLabel: 'School score',
    distributionTitle: 'School score',
    distributionDescription:
      'Spread of the current primary-school axis across all default-scope areas.',
    chartColor: '#65a30d',
    detail:
      'A higher school score means there are more realistically reachable state-funded primary schools and the stronger schools among that primary pool perform better in official data.',
    recipe:
      'This is now a primary-only blend of attainment, access, and a small attendance supplement. Access stays population-adjusted, so dense areas are not rewarded just for having more people around them.',
    formula:
      'School score = primary attainment basket 68% + population-adjusted primary access 22% + attendance 10%, with a modest Ofsted warning penalty when relevant',
  },
  {
    key: 'environment',
    label: 'Environment',
    rankingExplanationLabel: 'environment',
    mapLabel: 'Environment score',
    distributionTitle: 'Environment score',
    distributionDescription: 'Variation in pollution and green-space strength across all areas.',
    chartColor: '#16a34a',
    detail:
      'A higher environment score means cleaner air and better nearby green-space access.',
    recipe:
      'This mixes air quality with greenery. Lower PM2.5, lower NO2, higher green cover in a wider double-radius neighborhood buffer, more green area within 1 km, and a shorter distance to the nearest park all help.',
    formula:
      'Environment score = PM2.5 34% + NO2 16% + green cover 20% + green area 18% + park distance 12%',
  },
  {
    key: 'crime',
    label: 'Crime',
    rankingExplanationLabel: 'safety',
    mapLabel: 'Crime score',
    distributionTitle: 'Crime score',
    distributionDescription: 'Relative safety spread across the default search universe.',
    chartColor: '#0891b2',
    detail:
      'A higher crime score means lower recorded crime in the station-area catchment. It is effectively a safety score.',
    recipe:
      'The raw crime metric is annualised crime incidents per 1,000 residents, averaged across all currently available monthly police snapshots from 2023 onward. Lower raw crime rates are converted into higher-is-better safety scores for ranking.',
    formula: 'Crime score = inverse transform of crime rate per 1,000 residents',
  },
]

export const rankingAxisKeys: RankingAxisKey[] = rankingAxes.map((axis) => axis.key)

export const rankingAxisByKey = Object.fromEntries(
  rankingAxes.map((axis) => [axis.key, axis]),
) as Record<RankingAxisKey, RankingAxisDefinition>
