import Link from "next/link";

import hpStyles from "./home-page-components.module.css";
import { BrandLogo } from "./ui/brand-logo";

const LANDING_NAV_ITEMS = [
  { href: "#preview", label: "Пример радара" },
  { href: "#how-it-works", label: "Как работает" },
  { href: "#quality", label: "Методология" },
  { href: "#pricing", label: "Стоимость" },
] as const;

export default function LandingHeader({ activationHref }: { activationHref: string }) {
  return (
    <header className={hpStyles.topBar}>
      <Link
        href="/"
        className={hpStyles.brandMark}
        aria-label="Recruiter Radar — на главную"
      >
        <BrandLogo joined />
      </Link>
      <nav className={hpStyles.topNavLinks} aria-label="Разделы лендинга">
        <span className={hpStyles.topNavAnchors}>
          {LANDING_NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={hpStyles.topNavLink}
              data-landing-events={item.href === "#preview" ? "live_preview_opened" : undefined}
              data-landing-event-context={item.href === "#preview" ? "header" : undefined}
            >
              {item.label}
            </a>
          ))}
        </span>
        <span className={hpStyles.topNavActions}>
          <Link href="/dashboard" className={hpStyles.topNavLogin}>Войти</Link>
          <Link
            href={activationHref}
            className={hpStyles.topNavCta}
            data-landing-events="checkout_started"
            data-landing-event-context="header"
          >
            Собрать мой радар
          </Link>
        </span>
      </nav>
      <div className={hpStyles.mobileHeaderActions}>
        <Link
          href={activationHref}
          className={hpStyles.topNavCta}
          aria-label="Собрать мой радар"
          data-landing-events="checkout_started"
          data-landing-event-context="mobile-header"
        >
          Собрать радар
        </Link>
        <details className={hpStyles.mobileNav}>
          <summary>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M5 7h14M5 12h14M5 17h14" />
            </svg>
            Меню
          </summary>
          <nav aria-label="Мобильная навигация" className={hpStyles.mobileNavPanel}>
            {LANDING_NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                data-landing-events={item.href === "#preview" ? "live_preview_opened" : undefined}
                data-landing-event-context={item.href === "#preview" ? "mobile-menu" : undefined}
              >
                {item.label}
              </a>
            ))}
            <a href="#faq">FAQ</a>
            <Link href="/dashboard">Войти</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
