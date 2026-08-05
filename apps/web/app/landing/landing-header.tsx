"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { BrandLogo } from "../ui/brand-logo";
import { ArrowGlyph } from "./brand-glyphs";
import correctionStyles from "./landing-corrections.module.css";
import { LANDING_SCENES } from "./landing-copy";
import styles from "./landing.module.css";

const MOBILE_EXTRA_LINKS = [
  { id: "pricing", index: "06", label: "Тарифы" },
  { id: "faq", index: "07", label: "FAQ" },
] as const;

export default function LandingHeader({ previewHref }: { previewHref: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = true) => {
    if (restoreFocus) menuButtonRef.current?.focus({ preventScroll: true });
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const updateScrolledState = () => setScrolled(window.scrollY > 12);
    updateScrolledState();
    window.addEventListener("scroll", updateScrolledState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolledState);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuPanelRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      closeMenu();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    window.requestAnimationFrame(() => {
      menuPanelRef.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeMenu, menuOpen]);

  return (
    <header
      className={styles.header}
      data-brand-header="signal-lock"
      data-scrolled={scrolled || undefined}
      data-menu-open={menuOpen || undefined}
    >
      <div className={correctionStyles.headerInner}>
        <Link href="/" className={styles.headerBrand} aria-label="Recruiter Radar — на главную">
          <BrandLogo joined tone="dark" />
        </Link>
        <nav className={styles.sceneNav} aria-label="Сцены лендинга" data-desktop-navigation>
          {LANDING_SCENES.map((scene) => (
            <a key={scene.id} href={`#${scene.id}`} className={styles.sceneNavLink}>
              <span>{scene.index}</span>
              {scene.label}
            </a>
          ))}
        </nav>
        <div className={styles.headerActions} data-header-actions>
          <Link href="/dashboard" className={styles.headerLogin} data-header-login>Личный кабинет</Link>
          <a
            href={previewHref}
            className={styles.headerCta}
            data-header-primary-cta
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
          >
            Получить пример <ArrowGlyph />
          </a>
          <button
            ref={menuButtonRef}
            type="button"
            className={correctionStyles.mobileMenuButton}
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <button
        type="button"
        className={correctionStyles.mobileBackdrop}
        aria-label="Закрыть меню"
        hidden={!menuOpen}
        onClick={() => closeMenu()}
      />
      <div
        ref={menuPanelRef}
        id="landing-mobile-menu"
        className={correctionStyles.mobilePanel}
        hidden={!menuOpen}
      >
        <div className={correctionStyles.mobilePanelHeader}>
          <span>Навигация</span>
          <button type="button" className={correctionStyles.mobileClose} aria-label="Закрыть меню" onClick={() => closeMenu()}>
            ×
          </button>
        </div>
        <nav className={correctionStyles.mobileNav} aria-label="Мобильная навигация">
          {[...LANDING_SCENES, ...MOBILE_EXTRA_LINKS].map((scene) => (
            <a key={scene.id} href={`#${scene.id}`} onClick={() => closeMenu(false)}>
              <span>{scene.index}</span>
              {scene.label}
            </a>
          ))}
        </nav>
        <div className={correctionStyles.mobileActions}>
          <Link href="/dashboard" onClick={() => closeMenu(false)}>Личный кабинет</Link>
          <a
            href={previewHref}
            onClick={() => closeMenu(false)}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
          >
            Получить пример <ArrowGlyph />
          </a>
        </div>
      </div>
    </header>
  );
}
