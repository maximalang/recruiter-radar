"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import hpStyles from "./home-page-components.module.css";
import LandingMobileNav from "./landing-mobile-nav";

const LANDING_NAV_ITEMS = [
  { href: "#preview-configurator", sectionId: "preview", label: "Пример радара" },
  { href: "#how-it-works", sectionId: "how-it-works", label: "Как работает" },
  { href: "#quality", sectionId: "quality", label: "Методология" },
  { href: "#pricing", sectionId: "pricing", label: "Стоимость" },
] as const;

export default function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    let raf = 0;
    const updateScrollState = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 28);
        raf = 0;
      });
    };
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });

    const sections = LANDING_NAV_ITEMS
      .map((item) => document.getElementById(item.sectionId))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-22% 0px -64%", threshold: [0.05, 0.25, 0.6] });
    sections.forEach((section) => observer?.observe(section));

    return () => {
      window.removeEventListener("scroll", updateScrollState);
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, []);

  return (
    <header
      className={hpStyles.topBar}
      data-scrolled={scrolled ? "true" : "false"}
      data-brand-layout="landing-header-v2"
    >
      <Link
        href="/"
        className={hpStyles.brandMark}
        aria-label="Recruiter Radar — на главную"
        data-brand-wordmark="true"
        data-landing-entrance
      >
        <span className={hpStyles.brandWordmark}><span>Recruiter</span> <strong>Radar</strong></span>
      </Link>
      <nav className={hpStyles.topNavLinks} aria-label="Разделы лендинга">
        <span className={hpStyles.topNavAnchors}>
          {LANDING_NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={hpStyles.topNavLink}
              data-active={activeSection === item.sectionId ? "true" : "false"}
              aria-current={activeSection === item.sectionId ? "location" : undefined}
              data-landing-events={item.sectionId === "preview" ? "preview_started" : undefined}
              data-landing-event-context={item.sectionId === "preview" ? "header" : undefined}
            >
              {item.label}
            </a>
          ))}
        </span>
        <span className={hpStyles.topNavActions}>
          <Link href="/dashboard" className={hpStyles.topNavLogin}>Войти</Link>
          <Link
            href="#preview-configurator"
            className={hpStyles.topNavCta}
            data-landing-events="preview_started"
            data-landing-event-context="header"
          >
            Собрать мой радар
          </Link>
        </span>
      </nav>
      <div className={hpStyles.mobileHeaderActions}>
        <Link
          href="#preview-configurator"
          className={hpStyles.topNavCta}
          aria-label="Собрать мой радар"
          data-landing-events="preview_started"
          data-landing-event-context="mobile-header"
        >
          <span className={hpStyles.mobileCtaLong}>Собрать радар</span>
          <span className={hpStyles.mobileCtaShort}>Собрать</span>
        </Link>
        <LandingMobileNav items={LANDING_NAV_ITEMS} activeSection={activeSection} />
      </div>
    </header>
  );
}
