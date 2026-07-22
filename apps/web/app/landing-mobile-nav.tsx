"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";

import hpStyles from "./home-page-components.module.css";

type LandingNavItem = {
  href: string;
  sectionId: string;
  label: string;
};

export default function LandingMobileNav(props: { items: readonly LandingNavItem[]; activeSection?: string | null }) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);
  const tapLockRef = useRef(false);
  const [open, setOpen] = useState(false);

  const closeMobileNav = (event: MouseEvent<HTMLAnchorElement>) => {
    if (tapLockRef.current) {
      event.preventDefault();
      return;
    }
    tapLockRef.current = true;
    detailsRef.current?.removeAttribute("open");
    setOpen(false);
    window.setTimeout(() => { tapLockRef.current = false; }, 320);
  };

  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
  };

  useEffect(() => {
    if (!open) return;
    const close = (restoreFocus = false) => {
      detailsRef.current?.removeAttribute("open");
      setOpen(false);
      if (restoreFocus) summaryRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || detailsRef.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <details ref={detailsRef} className={hpStyles.mobileNav} onToggle={onToggle}>
      <summary ref={summaryRef} aria-expanded={open}>
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
            aria-current={props.activeSection === item.sectionId ? "location" : undefined}
            data-landing-events={item.sectionId === "preview" ? "preview_started" : undefined}
            data-landing-event-context={item.sectionId === "preview" ? "mobile-menu" : undefined}
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
