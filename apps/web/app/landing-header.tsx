"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../lib/landing-analytics-contract";
import hpStyles from "./home-page-components.module.css";
import { BrandLogo } from "./ui/brand-logo";

const NAV_ITEMS = [
  { id: "workflow", label: "Что меняется" },
  { id: "preview", label: "Продукт" },
  { id: "quality", label: "Доказательства" },
  { id: "delivery", label: "Рабочий ритм" },
  { id: "faq", label: "Вопросы" },
] as const;

export default function LandingHeader({ previewHref }: { previewHref: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeAndRestoreFocus = () => {
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAndRestoreFocus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <header
      ref={headerRef}
      className={hpStyles.topBar}
      data-landing-scroll-snap="sections"
      data-deploy-anchor="recruiter-radar-landing-v3"
      data-brand-header="recruiter-radar-evidence-v2"
    >
      <Link href="/" className={hpStyles.brandMark} aria-label="Recruiter Radar — на главную">
        <BrandLogo joined tone="dark" />
      </Link>
      <nav className={hpStyles.topNavLinks} aria-label="Навигация по лендингу Recruiter Radar">
        <span className={hpStyles.topNavAnchors}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={hpStyles.topNavLink}
            >
              {item.label}
            </a>
          ))}
        </span>
        <span className={hpStyles.topNavActions}>
          <Link href="/login" className={hpStyles.topNavLogin}>Войти</Link>
          <Link
            href={previewHref}
            className={hpStyles.topNavCta}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
          >
            Проверить свою нишу
          </Link>
          <button
            ref={triggerRef}
            type="button"
            className={hpStyles.mobileMenuTrigger}
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </span>
      </nav>
      <nav
        id="landing-mobile-menu"
        className={hpStyles.mobileMenu}
        aria-label="Мобильная навигация по лендингу"
        hidden={!menuOpen}
      >
        {NAV_ITEMS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </a>
        ))}
        <Link href="/login" onClick={() => setMenuOpen(false)}>Войти</Link>
        <Link
          href={previewHref}
          className={hpStyles.mobileMenuActivation}
          data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
          data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
          onClick={() => setMenuOpen(false)}
        >
          Проверить свою нишу
        </Link>
      </nav>
    </header>
  );
}
