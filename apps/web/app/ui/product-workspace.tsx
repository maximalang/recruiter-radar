import type { ReactElement, ReactNode, SVGProps } from "react";
import Link from "next/link";

import {
  BriefcaseIcon,
  LayersIcon,
  SearchIcon,
  TargetIcon,
  TrendIcon,
} from "./icons";
import { BrandLogo } from "./brand-logo";
import { AppCanvas, SignalIndicator, WorkspaceHeader } from "./intelligence-primitives";
import type { NavItem } from "./internal-page";
import styles from "./product-workspace.module.css";

type WorkspaceIcon = (props: SVGProps<SVGSVGElement>) => ReactElement;

type CoreDestination = {
  href: string;
  label: string;
  icon: WorkspaceIcon;
};

const CORE_DESTINATIONS: readonly CoreDestination[] = [
  { href: "/dashboard", label: "Сегодня", icon: TrendIcon },
  { href: "/leads", label: "Компании", icon: SearchIcon },
  { href: "/opportunities", label: "Ситуации", icon: BriefcaseIcon },
  { href: "/opportunities/radar", label: "Радар", icon: TargetIcon },
] as const;

const ACCOUNT_SECONDARY_LINKS = [
  { href: "/settings", label: "Настройки" },
  { href: "/settings/team", label: "Команда" },
  { href: "/settings/security", label: "Безопасность" },
  { href: "/settings/access", label: "Доступ и оплата" },
] as const;

const CORE_HREFS = new Set(CORE_DESTINATIONS.map((item) => item.href));

function uniqueNavItems(items: Array<NavItem | undefined>): NavItem[] {
  const seen = new Set<string>();
  const result: NavItem[] = [];
  for (const item of items) {
    if (!item || seen.has(item.href)) continue;
    seen.add(item.href);
    result.push(item);
  }
  return result;
}

function destinationIsActive(destination: CoreDestination, items: NavItem[]) {
  const explicit = items.find((item) => item.href === destination.href);
  if (explicit?.active) return true;
  if (destination.href === "/opportunities") {
    return items.some((item) => item.active && item.href.startsWith("/opportunities") && item.href !== "/opportunities/radar");
  }
  return false;
}

function buildCoreNavigation(items: NavItem[]) {
  return CORE_DESTINATIONS.map((destination) => ({
    ...destination,
    active: destinationIsActive(destination, items),
  }));
}

function buildMoreNavigation(items: NavItem[]) {
  const settings = items.find((item) => item.href === "/settings");
  const custom = items.filter((item) => !CORE_HREFS.has(item.href) && item.href !== "/settings");
  return uniqueNavItems([
    settings ?? { href: "/settings", label: "Настройки", active: false },
    ...custom,
    ...ACCOUNT_SECONDARY_LINKS.slice(1).map((item) => ({ ...item, active: false })),
  ]);
}

export function ProductWorkspaceFrame(props: { navItems: NavItem[]; children: ReactNode }) {
  const coreItems = buildCoreNavigation(props.navItems);
  const settingsActive = props.navItems.some((item) => item.active && (item.href === "/settings" || item.href.startsWith("/settings/")));

  return (
    <AppCanvas data-product-workspace="true" data-ui-system="recruiter-radar">
      <div className={styles.workspace}>
        <a href="#main-content" className={styles.skipLink}>К содержанию</a>

        <header className={styles.topbar}>
          <Link href="/" className={styles.topbarBrand} aria-label="Recruiter Radar — на главную">
            <BrandLogo size="small" joined />
          </Link>
          <nav className={styles.primaryNav} aria-label="Основные разделы">
            {coreItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={styles.primaryNavItem}
                data-active={item.active ? "true" : undefined}
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/settings"
            className={styles.accountLink}
            data-active={settingsActive ? "true" : undefined}
            aria-current={settingsActive ? "page" : undefined}
          >
            Аккаунт
          </Link>
        </header>

        <div className={styles.workspaceBody}>
          <div className={styles.mobileTopbar}>
            <Link href="/" aria-label="Recruiter Radar — на главную"><BrandLogo size="small" joined /></Link>
          </div>
          <main id="main-content" className={styles.content} tabIndex={-1}>{props.children}</main>
          <ProductFooter />
          <MobileNavigation items={props.navItems} />
        </div>
      </div>
    </AppCanvas>
  );
}

export function ProductWorkspaceHeader(props: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: "var(--space-8)" }}>
      <WorkspaceHeader
        eyebrow={props.eyebrow}
        title={props.title}
        description={props.subtitle}
        meta={props.status ? <SignalIndicator>{props.status}</SignalIndicator> : undefined}
        actions={props.actions}
      />
    </div>
  );
}

function MobileNavigation(props: { items: NavItem[] }) {
  const coreItems = buildCoreNavigation(props.items);
  const moreLinks = buildMoreNavigation(props.items);
  const moreActive = moreLinks.some((item) => item.active) || props.items.some((item) => item.active && !CORE_HREFS.has(item.href));

  return (
    <nav className={styles.mobileNav} aria-label="Мобильная навигация">
      {coreItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={styles.mobileNavItem}
            data-active={item.active ? "true" : undefined}
            aria-current={item.active ? "page" : undefined}
          >
            <Icon className={styles.mobileNavIcon} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <details className={styles.mobileMore} data-active={moreActive ? "true" : undefined}>
        <summary>
          <LayersIcon className={styles.mobileNavIcon} aria-hidden="true" />
          <span>Ещё</span>
        </summary>
        <div className={styles.mobileMoreMenu}>
          {moreLinks.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}>{item.label}</Link>
          ))}
        </div>
      </details>
    </nav>
  );
}

function ProductFooter() {
  return (
    <footer className={styles.productFooter} aria-label="Служебные ссылки">
      <Link href="/" className={styles.productFooterBrand}>Recruiter Radar</Link>
      <nav aria-label="Справка и документы">
        <a href="mailto:support@recruiter-radar.ru">Поддержка</a>
        <Link href="/legal">Документы</Link>
        <Link href="/privacy">Конфиденциальность</Link>
      </nav>
    </footer>
  );
}
