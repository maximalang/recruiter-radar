import type { ReactElement, ReactNode, SVGProps } from "react";
import Link from "next/link";

import {
  BriefcaseIcon,
  LayersIcon,
  SearchIcon,
  ShieldIcon,
  TargetIcon,
  TrendIcon,
} from "./icons";
import { BrandLogo } from "./brand-logo";
import type { NavItem } from "./internal-page";
import styles from "./product-workspace.module.css";

type WorkspaceIcon = (props: SVGProps<SVGSVGElement>) => ReactElement;

const NAV_ICONS: Record<string, WorkspaceIcon> = {
  "/dashboard": TrendIcon,
  "/leads": SearchIcon,
  "/review": ShieldIcon,
  "/profile": TargetIcon,
  "/settings": LayersIcon,
};

const ACCOUNT_SECONDARY_LINKS = [
  { href: "/settings/team", label: "Команда" },
  { href: "/settings/security", label: "Безопасность" },
] as const;

const STANDARD_ACCOUNT_HREFS = new Set([
  "/dashboard",
  "/leads",
  "/review",
  "/profile",
  "/settings",
]);

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

function isAccountSecondaryRoute(href: string): boolean {
  return href === "/profile" || href === "/settings" || href.startsWith("/settings/");
}

function buildMobileNavigation(items: NavItem[]) {
  const activeItem = items.find((item) => item.active);
  const activeOpportunity = activeItem?.href.startsWith("/opportunities")
    ? activeItem
    : undefined;
  const activeCustom = activeItem &&
    !STANDARD_ACCOUNT_HREFS.has(activeItem.href) &&
    !activeItem.href.startsWith("/opportunities") &&
    !isAccountSecondaryRoute(activeItem.href)
    ? activeItem
    : undefined;

  const dashboard = items.find((item) => item.href === "/dashboard");
  const leads = items.find((item) => item.href === "/leads");
  const review = items.find((item) => item.href === "/review");

  const preferredPrimary = activeOpportunity
    ? [activeOpportunity, leads, review, dashboard]
    : activeCustom
      ? [activeCustom, dashboard, leads, review]
      : [dashboard, leads, review];

  const primaryItems = uniqueNavItems([
    ...preferredPrimary,
    ...items.filter((item) => !isAccountSecondaryRoute(item.href)),
  ]).slice(0, 3);
  const primaryHrefs = new Set(primaryItems.map((item) => item.href));
  const hasAccountSettings = items.some((item) => item.href === "/settings");
  const secondaryLinks = hasAccountSettings
    ? ACCOUNT_SECONDARY_LINKS.map((item) => ({ ...item }))
    : [];
  const moreLinks = uniqueNavItems([
    ...items.filter((item) => !primaryHrefs.has(item.href)),
    ...secondaryLinks,
  ]);

  return {
    primaryItems,
    moreLinks,
    moreActive: moreLinks.some((item) => item.active),
  };
}

export function ProductWorkspaceFrame(props: {
  navItems: NavItem[];
  children: ReactNode;
}) {
  return (
    <div
      className={styles.workspace}
      data-product-workspace="true"
      data-ui-system="recruiter-radar-v7"
    >
      <a href="#main-content" className={styles.skipLink}>К содержанию</a>

      <aside className={styles.sidebar} aria-label="Рабочее пространство Recruiter Radar">
        <div className={styles.sidebarBrand}>
          <Link href="/" aria-label="Recruiter Radar — на главную">
            <BrandLogo tone="dark" joined />
          </Link>
        </div>

        <nav className={styles.sidebarNav} aria-label="Разделы кабинета">
          {props.navItems.map((item) => {
            const Icon = NAV_ICONS[item.href] ?? BriefcaseIcon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.navItem}
                data-active={item.active ? "true" : undefined}
                aria-current={item.active ? "page" : undefined}
              >
                <Icon className={styles.navIcon} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className={styles.workspaceBody}>
        <div className={styles.mobileTopbar}>
          <Link href="/" aria-label="Recruiter Radar — на главную">
            <BrandLogo joined />
          </Link>
        </div>

        <main id="main-content" className={styles.content} tabIndex={-1}>
          {props.children}
        </main>

        <ProductFooter />
        <MobileNavigation items={props.navItems} />
      </div>
    </div>
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
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderCopy}>
        {props.eyebrow ? <span className={styles.pageEyebrow}>{props.eyebrow}</span> : null}
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
      <div className={styles.pageHeaderAside}>
        {props.status ? <div className={styles.pageStatus}>{props.status}</div> : null}
        {props.actions ? <div className={styles.pageActions}>{props.actions}</div> : null}
      </div>
    </header>
  );
}

function MobileNavigation(props: { items: NavItem[] }) {
  const { primaryItems, moreLinks, moreActive } = buildMobileNavigation(props.items);

  return (
    <nav className={styles.mobileNav} aria-label="Мобильная навигация">
      {primaryItems.map((item) => {
        const Icon = NAV_ICONS[item.href] ?? BriefcaseIcon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={styles.mobileNavItem}
            data-active={item.active ? "true" : undefined}
            aria-current={item.active ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            <span>{item.href === "/review" ? "Проверка" : item.label}</span>
          </Link>
        );
      })}
      {moreLinks.length > 0 ? (
        <details className={styles.mobileMore} data-active={moreActive ? "true" : undefined}>
          <summary>
            <LayersIcon aria-hidden="true" />
            <span>Ещё</span>
          </summary>
          <div className={styles.mobileMoreMenu}>
            {moreLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </details>
      ) : null}
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
