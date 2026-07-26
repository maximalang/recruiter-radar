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
