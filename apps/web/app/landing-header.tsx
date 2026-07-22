import Link from "next/link";

import hpStyles from "./home-page-components.module.css";
import LandingMobileNav from "./landing-mobile-nav";
import { BrandLogo } from "./ui/brand-logo";

const LANDING_NAV_ITEMS = [
  { href: "#preview", label: "Пример радара" },
  { href: "#how-it-works", label: "Как работает" },
  { href: "#quality", label: "Методология" },
  { href: "#pricing", label: "Стоимость" },
] as const;

export default function LandingHeader() {
  return (
    <header className={hpStyles.topBar}>
      <Link
        href="/"
        className={hpStyles.brandMark}
        aria-label="Recruiter Radar — на главную"
      >
        <BrandLogo joined showMark priority />
      </Link>
      <nav className={hpStyles.topNavLinks} aria-label="Разделы лендинга">
        <span className={hpStyles.topNavAnchors}>
          {LANDING_NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={hpStyles.topNavLink}
              data-landing-events={item.href === "#preview" ? "preview_started" : undefined}
              data-landing-event-context={item.href === "#preview" ? "header" : undefined}
            >
              {item.label}
            </a>
          ))}
        </span>
        <span className={hpStyles.topNavActions}>
          <Link href="/dashboard" className={hpStyles.topNavLogin}>Войти</Link>
          <Link
            href="#preview"
            className={hpStyles.topNavCta}
            data-landing-events="preview_started"
            data-landing-event-context="header"
          >
            Собрать мой радар
          </Link>
        </span>
      </nav>
      <div className={hpStyles.mobileHeaderActions}>
        <Link
          href="#preview"
          className={hpStyles.topNavCta}
          aria-label="Собрать мой радар"
          data-landing-events="preview_started"
          data-landing-event-context="mobile-header"
        >
          Собрать радар
        </Link>
        <LandingMobileNav items={LANDING_NAV_ITEMS} />
      </div>
    </header>
  );
}
