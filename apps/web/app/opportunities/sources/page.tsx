import { redirect } from 'next/navigation'

export default function LegacyEvidenceSourceRegistryRoute() {
  redirect('/settings/diagnostics/sources')
}
