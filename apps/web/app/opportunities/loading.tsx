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
        title="Ситуации"
        subtitle="Собираем очереди действий и проверяем актуальность доказательств."
      />
      <LoadingState variant="skeleton" />
    </InternalPageFrame>
  )
}
