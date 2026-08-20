import { buildAccountNavigation } from "../ui/account-navigation";
import { LoadingState } from "../ui/internal-page";
import { ProductWorkspaceFrame, ProductWorkspaceHeader } from "../ui/product-workspace";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

export default function DashboardLoading() {
  return (
    <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
      <ProductWorkspaceHeader title="Сегодня" subtitle="Проверяем доступ и собираем приоритетные компании и изменения." />
      <LoadingState variant="skeleton" />
    </ProductWorkspaceFrame>
  );
}
