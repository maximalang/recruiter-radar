"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../lib/landing-analytics-contract";
import hpStyles from "./home-page-components.module.css";
import LandingMotionPreference from "./landing-motion/motion-preference";
import { BrandLogo } from "./ui/brand-logo";

const NAV_ITEMS = [
  { id: "preview", label: "Пример выдачи" },
  { id: "how-it-works", label: "Как работает" },
  { id: "quality", label: "Как проверяем" },
  { id: "pricing", label: "Тарифы" },
  { id: "faq", label: "Вопросы" },
] as const;

export default function LandingHeader({ previewHref }: { previewHref: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, { ratio: number; top: number }>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).id;
        if (!id) continue;
        if (entry.isIntersecting && entry.intersectionRatio > 0) {
          visible.set(id, {
            ratio: entry.intersectionRatio,
            top: entry.boundingClientRect.top,
          });
        } else {
          visible.delete(id);
        }
      }
      const next = [...visible.entries()].sort((left, right) => {
        const offsetDifference = Math.abs(left[1].top - 92) - Math.abs(right[1].top - 92);
        return offsetDifference || right[1].ratio - left[1].ratio;
      })[0]?.[0];
      if (next) setActiveSection(next);
    }, {
      rootMargin: "-92px 0px -55% 0px",
      threshold: [0, 0.15, 0.4, 0.75],
    });

    for (const item of NAV_ITEMS) {
      const section = document.getElementById(item.id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, []);

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

  const activateSection = (id: string, closeMenu = false) => {
    setActiveSection(id);
    if (closeMenu) setMenuOpen(false);
  };

  return (
    <header
      ref={headerRef}
      className={hpStyles.topBar}
      data-deploy-anchor="recruiter-radar-landing-v3"
      data-brand-header="recruiter-radar-v3"
      style={{
        position: "fixed",
        top: "14px",
        left: "50%",
        width: "min(1160px, calc(100vw - 32px))",
        transform: "translateX(-50%)",
      }}
    >
      <Link href="/" className={hpStyles.brandMark} aria-label="Recruiter Radar — на главную">
        <BrandLogo joined />
      </Link>
      <nav className={hpStyles.topNavLinks} aria-label="Навигация по лендингу Recruiter Radar">
        <span className={hpStyles.topNavAnchors}>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={hpStyles.topNavLink}
              data-active={activeSection === item.id ? "true" : undefined}
              aria-current={activeSection === item.id ? "location" : undefined}
              onClick={() => activateSection(item.id)}
            >
              {item.label}
            </a>
          ))}
        </span>
        <span className={hpStyles.topNavActions}>
          <LandingMotionPreference />
          <Link href="/dashboard" className={hpStyles.topNavLogin}>Личный кабинет</Link>
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
            data-active={activeSection === item.id ? "true" : undefined}
            aria-current={activeSection === item.id ? "location" : undefined}
            onClick={() => activateSection(item.id, true)}
          >
            {item.label}
          </a>
        ))}
        <Link href="/dashboard" onClick={() => setMenuOpen(false)}>Личный кабинет</Link>
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
