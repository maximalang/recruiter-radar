import { buildAccountNavigation } from "../ui/account-navigation";
import { InternalPageFrame, InternalPageHeader, LoadingState } from "../ui/internal-page";

const LEADS_NAV = buildAccountNavigation("leads");

export default function LeadsLoading() {
  return (
    <InternalPageFrame navItems={LEADS_NAV}>
      <InternalPageHeader title="Возможности" subtitle="Загружаем доказательства и статусы" />
      <LoadingState variant="skeleton" />
    </InternalPageFrame>
  );
}
