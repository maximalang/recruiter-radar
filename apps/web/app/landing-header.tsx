import Link from "next/link";

import hpStyles from "./home-page-components.module.css";

export default function LandingHeader() {
  return (
    <header className={hpStyles.topBar}>
      <Link
        href="/"
        className={hpStyles.brandMark}
        aria-label="Recruiter Radar — на главную"
      >
        <span className={hpStyles.heroBrandName}>
          Recruiter <span className={hpStyles.brandNameAccent}>Radar</span>
        </span>
      </Link>
      <nav className={hpStyles.topNavLinks} aria-label="Разделы лендинга">
        <span className={hpStyles.topNavAnchors}>
          <a href="#preview" className={hpStyles.topNavLink}>Пример</a>
          <a href="#pricing" className={hpStyles.topNavLink}>Тарифы</a>
          <a href="#faq" className={hpStyles.topNavLink}>FAQ</a>
        </span>
        <Link href="/dashboard" className={hpStyles.topNavCta}>
          <span className={hpStyles.topNavCtaFull}>Войти в аккаунт</span>
          <span className={hpStyles.topNavCtaShort} aria-hidden="true">Войти</span>
        </Link>
      </nav>
    </header>
  );
}
