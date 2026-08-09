import { buildAccountNavigation } from "../ui/account-navigation";
import { LoadingState } from "../ui/internal-page";
import { ProductWorkspaceFrame, ProductWorkspaceHeader } from "../ui/product-workspace";

const DASHBOARD_NAV = buildAccountNavigation("dashboard");

export default function DashboardLoading() {
  return (
    <ProductWorkspaceFrame navItems={DASHBOARD_NAV}>
      <ProductWorkspaceHeader eyebrow="Dashboard" title="Загружаем командный центр" subtitle="Проверяем доступ и собираем актуальные возможности." />
      <LoadingState variant="skeleton" />
    </ProductWorkspaceFrame>
  );
}
