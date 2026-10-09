"use client";

import { useEffect, useRef, useState } from "react";
import { storyCopy as copy } from "./story-copy";
import styles from "./story.module.css";

const navigation = [["#workflow", copy.nav_problem], ["#card", copy.nav_card], ["#boundary", copy.nav_boundary]] as const;
const productHref = "https://recruiter-radar.ru";

/** Scoped adaptation of LandingHeader's passive scroll/data-scrolled contract. */
export default function StoryHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 12);
    updateScrolled();
    setEnhanced(true);
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  const brand = <a className={styles.brand} href={productHref}><span className={styles.brandMark} aria-hidden="true">◒</span>{copy.brand}</a>;
  return (
    <header className={styles.storyHeader} data-test="header" data-header-enhanced={enhanced || undefined} data-scrolled={scrolled || undefined}>
      <div className={styles.headerTop}>{brand}</div>
      <div className={styles.header} data-header-panel onFocusCapture={() => setScrolled(true)}>
        {brand}
        <nav className={styles.desktopNav} aria-label="Разделы страницы">{navigation.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
        <details ref={menuRef} className={styles.mobileNav} onKeyDown={(event) => {
          if (event.key === "Escape" && menuRef.current?.open) {
            event.preventDefault();
            menuRef.current.open = false;
            menuRef.current.querySelector("summary")?.focus();
          }
        }}>
          <summary><span className={styles.menuOpen}>{copy.menu_open_label}</span><span className={styles.menuClose}>{copy.menu_close_label}</span><span aria-hidden="true">☰</span></summary>
          <nav aria-label="Разделы страницы">{navigation.map(([href, label]) => <a key={href} href={href} onClick={() => {
            if (menuRef.current) menuRef.current.open = false;
            // The selected link will be hidden; move focus to its destination.
            document.querySelector<HTMLElement>(href)?.focus({ preventScroll: true });
          }}>{label}</a>)}</nav>
        </details>
        <div className={styles.headerCta}><a className={styles.cta} href={productHref} data-story-cta="header">{copy.primary_cta}<span aria-hidden="true">↗</span></a></div>
      </div>
    </header>
  );
}
