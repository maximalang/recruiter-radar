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
import polish from "./product-workspace-polish.module.css";
import styles from "./product-workspace.module.css";

type WorkspaceIcon = (props: SVGProps<SVGSVGElement>) => ReactElement;

const NAV_ICONS: Record<string, WorkspaceIcon> = {
  "/dashboard": TrendIcon,
  "/leads": SearchIcon,
  "/review": ShieldIcon,
  "/profile": TargetIcon,
  "/settings": LayersIcon,
};

export function ProductWorkspaceFrame(props: {
  navItems: NavItem[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className={`${styles.workspace} ${polish.workspace}`}
      data-product-workspace="true"
      data-ui-system="recruiter-radar-v7"
    >
      <a href="#main-content" className={styles.skipLink}>Перейти к содержимому</a>

      <aside className={`${styles.sidebar} ${polish.sidebar}`} aria-label="Рабочее пространство Recruiter Radar">
        <div className={`${styles.sidebarBrand} ${polish.sidebarBrand}`}>
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
                className={`${styles.navItem} ${polish.navItem}`}
                data-active={item.active ? "true" : undefined}
                aria-current={item.active ? "page" : undefined}
              >
                <Icon className={styles.navIcon} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={`${styles.sidebarStatus} ${polish.sidebarStatus}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          <strong>Радар активен</strong>
        </div>
      </aside>

      <div className={`${styles.workspaceBody} ${polish.workspaceBody}`}>
        <div className={styles.mobileTopbar}>
          <Link href="/" aria-label="Recruiter Radar — на главную">
            <BrandLogo joined />
          </Link>
        </div>

        <main id="main-content" className={`${styles.content} ${polish.content}`} tabIndex={-1}>
          {props.children}
        </main>

        {props.footer ? <div className={styles.footer}>{props.footer}</div> : null}
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
    <header className={`${styles.pageHeader} ${polish.pageHeader}`}>
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
