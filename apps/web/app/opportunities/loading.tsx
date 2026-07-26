import {
  InternalPageFrame,
  InternalPageHeader,
  LoadingState,
} from '../ui/internal-page'
import { buildOpportunityNavigation } from './navigation'

export default function OpportunitiesLoading() {
  return (
    <InternalPageFrame navItems={buildOpportunityNavigation()}>
      <InternalPageHeader
        title="Morning Brief"
        subtitle="Собираем свежие эпизоды и доказательства."
      />
      <LoadingState variant="skeleton" />
    </InternalPageFrame>
  )
}
