import Link from "next/link";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { BrandLogo } from "../ui/brand-logo";
import { ArrowGlyph } from "./brand-glyphs";
import { LANDING_SCENES } from "./landing-copy";
import styles from "./landing.module.css";

export default function LandingHeader({ previewHref }: { previewHref: string }) {
  return (
    <header className={styles.header} data-brand-header="signal-lock">
      <Link href="/" className={styles.headerBrand} aria-label="Recruiter Radar — на главную">
        <BrandLogo joined tone="dark" />
      </Link>
      <nav className={styles.sceneNav} aria-label="Сцены лендинга">
        {LANDING_SCENES.map((scene) => (
          <a key={scene.id} href={`#${scene.id}`} className={styles.sceneNavLink}>
            <span>{scene.index}</span>
            {scene.label}
          </a>
        ))}
      </nav>
      <div className={styles.headerActions}>
        <Link href="/dashboard" className={styles.headerLogin}>Личный кабинет</Link>
        <a
          href={previewHref}
          className={styles.headerCta}
          data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
          data-analytics-context={LANDING_ANALYTICS_CONTEXT.header}
        >
          Собрать радар <ArrowGlyph />
        </a>
      </div>
    </header>
  );
}
