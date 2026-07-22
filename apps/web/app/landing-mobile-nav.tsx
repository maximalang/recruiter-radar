"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

import hpStyles from "./home-page-components.module.css";

type LandingNavItem = {
  href: string;
  label: string;
};

function closeMobileNav(event: MouseEvent<HTMLAnchorElement>) {
  event.currentTarget.closest("details")?.removeAttribute("open");
}

export default function LandingMobileNav(props: { items: readonly LandingNavItem[] }) {
  return (
    <details className={hpStyles.mobileNav}>
      <summary>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
        Меню
      </summary>
      <nav aria-label="Мобильная навигация" className={hpStyles.mobileNavPanel}>
        {props.items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            data-landing-events={item.href === "#preview" ? "preview_started" : undefined}
            data-landing-event-context={item.href === "#preview" ? "mobile-menu" : undefined}
            onClick={closeMobileNav}
          >
            {item.label}
          </a>
        ))}
        <a href="#faq" onClick={closeMobileNav}>FAQ</a>
        <Link href="/dashboard" onClick={closeMobileNav}>Войти</Link>
      </nav>
    </details>
  );
}
