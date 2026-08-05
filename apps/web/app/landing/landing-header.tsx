"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { BrandLogo } from "../ui/brand-logo";
import { ArrowGlyph } from "./brand-glyphs";
import { LANDING_NAV_ITEMS } from "./landing-copy";
import styles from "./landing.module.css";

type HeaderTone = "dark" | "light";

export default function LandingHeader({ previewHref }: { previewHref: string }) {
  const [activeId, setActiveId] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [tone, setTone] = useState<HeaderTone>("dark");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    const menu = menuRef.current;
    if (!menu?.open) return;
    menu.open = false;
    setMenuOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => summaryRef.current?.focus());
  }, []);

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 20);
    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  useEffect(() => {
    const sectionElements = LANDING_NAV_ITEMS
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => Boolean(element));
    const toneElements = Array.from(document.querySelectorAll<HTMLElement>("[data-header-tone]"));

    const activeObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
      const nearest = visible[0]?.target as HTMLElement | undefined;
      if (nearest?.id) setActiveId(nearest.id);
    }, { rootMargin: "-24% 0px -62% 0px", threshold: [0, 0.01, 0.25] });

    const toneObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
      const nearest = visible[0]?.target as HTMLElement | undefined;
      const nextTone = nearest?.dataset.headerTone;
      if (nextTone === "dark" || nextTone === "light") setTone(nextTone);
    }, { rootMargin: "-4% 0px -88% 0px", threshold: [0, 0.01] });

    sectionElements.forEach((element) => activeObserver.observe(element));
    toneElements.forEach((element) => toneObserver.observe(element));

    return () => {
      activeObserver.disconnect();
      toneObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuRef.current?.open) closeMenu(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.open && target && !menuRef.current.contains(target)) closeMenu(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeMenu]);

  const navLinks = LANDING_NAV_ITEMS.map((item) => (
    <a
      key={item.id}
      href={`#${item.id}`}
      className={styles.sceneNavLink}
      aria-current={activeId === item.id ? "location" : undefined}
      data-active={activeId === item.id || undefined}
      onClick={() => closeMenu(false)}
    >
      {item.label}
    </a>
  ));

  return (
    <header
      className={styles.header}
      data-brand-header="signal-lock"
      data-scrolled={scrolled || undefined}
      data-tone={tone}
    >
      <div className={styles.headerInner}>
        <Link href="/" className={styles.headerBrand} aria-label="Recruiter Radar — на главную">
          <BrandLogo joined tone="dark" />
        </Link>

        <nav className={styles.sceneNav} aria-label="Разделы лендинга">
          {navLinks}
        </nav>

        <div className={styles.headerActions}>
          <Link href="/dashboard" className={styles.headerLogin}>Войти</Link>
          <a
            href={previewHref}
            className={styles.headerCta}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
          >
            Настроить радар <ArrowGlyph />
          </a>

          <details
            ref={menuRef}
            className={styles.mobileMenu}
            onToggle={(event) => setMenuOpen(event.currentTarget.open)}
          >
            <summary
              ref={summaryRef}
              aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={menuOpen}
            >
              <span aria-hidden="true" /><span aria-hidden="true" />
            </summary>
            <div className={styles.mobileMenuPanel}>
              <nav aria-label="Мобильная навигация">{navLinks}</nav>
              <Link href="/dashboard" onClick={() => closeMenu(false)}>Личный кабинет</Link>
              <a
                href={previewHref}
                className={styles.mobileMenuCta}
                onClick={() => closeMenu(false)}
                data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
                data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
              >
                Настроить preview <ArrowGlyph />
              </a>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
