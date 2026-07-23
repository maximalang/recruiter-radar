"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import hpStyles from "./home-page-components.module.css";
import LandingMotionPreference from "./landing-motion/motion-preference";
import { BrandLogo } from "./ui/brand-logo";

export default function LandingHeader({ activationHref }: { activationHref: string }) {
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

  const closeMenu = () => setMenuOpen(false);

  return (
    <header ref={headerRef} className={hpStyles.topBar}>
      <Link
        href="/"
        className={hpStyles.brandMark}
        aria-label="Recruiter Radar — на главную"
      >
        <BrandLogo joined />
      </Link>
      <nav className={hpStyles.topNavLinks} aria-label="Разделы лендинга">
        <span className={hpStyles.topNavAnchors}>
          <a href="#preview" className={hpStyles.topNavLink}>Пример</a>
          <a href="#how-it-works" className={hpStyles.topNavLink}>Как работает</a>
          <a href="#quality" className={hpStyles.topNavLink}>Проверка</a>
          <a href="#pricing" className={hpStyles.topNavLink}>Тарифы</a>
          <a href="#faq" className={hpStyles.topNavLink}>FAQ</a>
        </span>
        <span className={hpStyles.topNavActions}>
          <LandingMotionPreference />
          <Link href="/dashboard" className={hpStyles.topNavLogin}>Войти</Link>
          <Link href={activationHref} className={hpStyles.topNavCta}>
            Попробовать неделю
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
        aria-label="Мобильные разделы лендинга"
        hidden={!menuOpen}
      >
        <a href="#preview" onClick={closeMenu}>Пример</a>
        <a href="#how-it-works" onClick={closeMenu}>Как работает</a>
        <a href="#quality" onClick={closeMenu}>Проверка</a>
        <a href="#pricing" onClick={closeMenu}>Тарифы</a>
        <a href="#faq" onClick={closeMenu}>FAQ</a>
        <Link href="/dashboard" onClick={closeMenu}>Войти</Link>
        <Link
          href={activationHref}
          className={hpStyles.mobileMenuActivation}
          onClick={closeMenu}
        >
          Попробовать неделю
        </Link>
      </nav>
    </header>
  );
}
