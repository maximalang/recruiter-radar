import Link from "next/link";

import hpStyles from "./home-page-components.module.css";
import { BrandLogo } from "./ui/brand-logo";

export default function LandingHeader({ activationHref }: { activationHref: string }) {
  return (
    <header className={hpStyles.topBar}>
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
          <Link href="/dashboard" className={hpStyles.topNavLogin}>Войти</Link>
          <Link href={activationHref} className={hpStyles.topNavCta}>
            Попробовать неделю
          </Link>
        </span>
      </nav>
    </header>
  );
}
