import { buildAccountNavigation } from '../ui/account-navigation'

export function buildOpportunityNavigation() {
  const base = buildAccountNavigation('dashboard').map((item) => ({
    ...item,
    active: false,
  }))
  return [
    base[0],
    { href: '/opportunities', label: 'Возможности', active: true },
    ...base.slice(1),
  ]
}

export function buildOpportunityRadarNavigation(
  active: 'opportunities' | 'radar' | 'sources',
) {
  const base = buildAccountNavigation('dashboard').map((item) => ({
    ...item,
    active: false,
  }))
  return [
    base[0],
    {
      href: '/opportunities',
      label: 'Возможности',
      active: active === 'opportunities',
    },
    {
      href: '/opportunities/radar',
      label: 'Карта спроса',
      active: active === 'radar',
    },
    {
      href: '/opportunities/sources',
      label: 'Источники',
      active: active === 'sources',
    },
    ...base.slice(1),
  ]
}
