import { buildAccountNavigation } from "../ui/account-navigation";
import { InternalPageFrame, InternalPageHeader, LoadingState } from "../ui/internal-page";

const REVIEW_NAV = buildAccountNavigation("review");

export default function ReviewLoading() {
  return (
    <InternalPageFrame navItems={REVIEW_NAV}>
      <InternalPageHeader title="Очередь проверки" subtitle="Загружаем кандидатов и доказательства" />
      <LoadingState variant="skeleton" />
    </InternalPageFrame>
  );
}
