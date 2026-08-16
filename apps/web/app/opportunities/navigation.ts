import { buildAccountNavigation } from '../ui/account-navigation'

export function buildOpportunityNavigation() {
  return buildAccountNavigation('opportunities')
}

export function buildOpportunityRadarNavigation(
  active: 'opportunities' | 'radar' | 'sources',
) {
  const base = buildAccountNavigation(active === 'radar' ? 'radar' : 'opportunities')
  if (active !== 'sources') return base

  return [
    ...base.map((item) => ({ ...item, active: false })),
    {
      href: '/opportunities/sources',
      label: 'Диагностика источников',
      active: true,
    },
  ]
}
