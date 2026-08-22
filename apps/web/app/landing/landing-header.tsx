"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { BrandLogo } from "../ui/brand-logo";
import { ArrowGlyph } from "./brand-glyphs";
import headerStyles from "./landing-header.module.css";
import { LANDING_NAV_ITEMS } from "./landing-copy";
import styles from "./landing.module.css";

type HeaderTone = "dark" | "light";

const LOGIN_HREF = "/login?returnTo=%2Fdashboard";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function LandingHeader({ previewHref }: { previewHref: string }) {
  const [activeId, setActiveId] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [tone, setTone] = useState<HeaderTone>("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback((restoreFocus = true) => {
    if (restoreFocus) menuButtonRef.current?.focus({ preventScroll: true });
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 12);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  useEffect(() => {
    const sectionElements = LANDING_NAV_ITEMS
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => Boolean(element));
    const toneElements = Array.from(document.querySelectorAll<HTMLElement>("[data-header-tone]"));

    let activeFrame = 0;
    const updateActiveSection = () => {
      window.cancelAnimationFrame(activeFrame);
      activeFrame = window.requestAnimationFrame(() => {
        const marker = Math.max(72, Math.min(window.innerHeight * 0.2, 160));
        const current = sectionElements.reduce<HTMLElement | null>((match, element) => (
          element.getBoundingClientRect().top <= marker ? element : match
        ), null);
        setActiveId(current?.id ?? "");
      });
    };

    const resolveToneByGeometry = () => {
      // Short mobile sections can cross the decision band without ever leaving
      // the previous marker (the hero keeps intersecting the band), so no
      // entry reports a transition. Resolve the nearest marker above the
      // decision line directly, mirroring updateActiveSection.
      const fallbackMarker = Math.max(72, Math.min(window.innerHeight * 0.2, 160));
      const current = toneElements.reduce<HTMLElement | null>((match, element) => (
        element.getBoundingClientRect().top <= fallbackMarker ? element : match
      ), null);
      const nextTone = current?.dataset.headerTone;
      if (nextTone === "dark" || nextTone === "light") setTone(nextTone);
    };

    const toneObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
      const nearest = visible[0]?.target as HTMLElement | undefined;
      if (!nearest) {
        resolveToneByGeometry();
        return;
      }
      const nextTone = nearest?.dataset.headerTone;
      if (nextTone === "dark" || nextTone === "light") setTone(nextTone);
    }, { rootMargin: "-4% 0px -88% 0px", threshold: [0, 0.01] });

    toneElements.forEach((element) => toneObserver.observe(element));
    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    window.addEventListener("hashchange", updateActiveSection);

    return () => {
      window.cancelAnimationFrame(activeFrame);
      toneObserver.disconnect();
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
      window.removeEventListener("hashchange", updateActiveSection);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const panel = menuPanelRef.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        menuButtonRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel?.contains(target) || menuButtonRef.current?.contains(target)) return;
      closeMenu(true);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    window.requestAnimationFrame(() => focusable()[0]?.focus({ preventScroll: true }));

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeMenu, menuOpen]);

  const renderNavLink = (item: (typeof LANDING_NAV_ITEMS)[number]) => (
    <a
      key={item.id}
      href={`#${item.id}`}
      className={headerStyles.navLink}
      aria-current={activeId === item.id ? "location" : undefined}
      data-active={activeId === item.id || undefined}
      onClick={() => closeMenu(false)}
    >
      {item.label}
    </a>
  );

  const logoTone = scrolled || menuOpen ? "light" : tone;

  return (
    <header
      className={headerStyles.header}
      data-brand-header="recruiter-radar"
      data-scrolled={scrolled || undefined}
      data-tone={tone}
      data-menu-open={menuOpen || undefined}
    >
      <div className={headerStyles.inner}>
        <Link
          href="/"
          className={`${styles.headerBrand} ${headerStyles.brand}`}
          aria-label="Recruiter Radar — на главную"
        >
          <BrandLogo joined tone={logoTone} />
        </Link>

        <nav className={headerStyles.desktopNav} aria-label="Разделы лендинга">
          {LANDING_NAV_ITEMS.map(renderNavLink)}
        </nav>

        <div className={headerStyles.actions}>
          <Link href={LOGIN_HREF} className={headerStyles.login}>Войти</Link>
          <a
            href={previewHref}
            className={headerStyles.cta}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
          >
            Посмотреть пример <ArrowGlyph />
          </a>
          <button
            ref={menuButtonRef}
            type="button"
            className={headerStyles.menuButton}
            aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            data-open={menuOpen || undefined}
            onClick={() => setMenuOpen((current) => !current)}
          />
        </div>
      </div>

      <div className={headerStyles.backdrop} hidden={!menuOpen} aria-hidden="true" />
      <div
        ref={menuPanelRef}
        id="landing-mobile-menu"
        className={headerStyles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-mobile-menu-title"
        hidden={!menuOpen}
      >
        <div id="landing-mobile-menu-title" className={headerStyles.panelIntro}>Навигация по продукту</div>
        <nav className={headerStyles.mobileNav} aria-label="Мобильная навигация">
          {LANDING_NAV_ITEMS.map(renderNavLink)}
        </nav>
        <div className={headerStyles.mobileActions}>
          <Link href={LOGIN_HREF} onClick={() => closeMenu(false)}>Войти</Link>
          <a
            href={previewHref}
            onClick={() => closeMenu(false)}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
          >
            Посмотреть пример <ArrowGlyph />
          </a>
        </div>
      </div>
    </header>
  );
}
