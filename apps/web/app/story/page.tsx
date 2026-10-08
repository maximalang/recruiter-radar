import type { Metadata } from "next";
import type { ReactNode } from "react";

import { EvidenceConstellation, FieldMark, PaperArt } from "./story-art";
import { storyCopy as copy } from "./story-copy";
import ScrollDemo from "./scroll-demo";
import StoryMotion from "./story-motion";
import styles from "./story.module.css";

export const metadata: Metadata = {
  title: copy.meta_title,
  description: copy.meta_description,
  alternates: { canonical: "/story" },
  robots: { index: false, follow: true }, // Owner preview, not an SEO/publishing decision.
  openGraph: { title: copy.meta_title, description: copy.meta_description, url: "/story" },
  twitter: { title: copy.meta_title, description: copy.meta_description },
};

const productHref = "https://recruiter-radar.ru";
const navigation = [["#problem", copy.nav_problem], ["#card", copy.nav_card], ["#boundary", copy.nav_boundary]] as const;
const fields = [
  [copy.feature_1_h3, copy.feature_1_body],
  [copy.feature_2_h3, copy.feature_2_body],
  [copy.feature_3_h3, copy.feature_3_body],
  [copy.feature_4_h3, copy.feature_4_body],
  [copy.feature_5_h3, copy.feature_5_body],
] as const;

function ProductLink({ location }: { location: string }) {
  return <a className={styles.cta} href={productHref} data-story-cta={location}>{copy.primary_cta}<span aria-hidden="true">↗</span></a>;
}

function SceneHeading({ step, title, body, children }: { step: string; title: string; body: string; children?: ReactNode }) {
  return <div className={styles.sceneCopy} data-story-reveal="text"><span className={styles.step} aria-hidden="true">{step} / RR</span><h2 id="boundary-title">{title}</h2><p>{body}</p>{children}</div>;
}

export default function StoryPage() {
  return (
    <div className={styles.story} data-story-experience="evidence-to-contact">
      <StoryMotion />
      <a className={styles.skip} href="#story-main">Перейти к содержанию</a>
      <header className={styles.header}>
        <a className={styles.brand} href={productHref}><span className={styles.brandMark} aria-hidden="true">◒</span>{copy.brand}</a>
        <nav className={styles.desktopNav} aria-label="Разделы страницы">{navigation.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
        <details className={styles.mobileNav}>
          <summary><span className={styles.menuOpen}>{copy.menu_open_label}</span><span className={styles.menuClose}>{copy.menu_close_label}</span><span aria-hidden="true">☰</span></summary>
          <nav aria-label="Разделы страницы">{navigation.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
        </details>
        <div className={styles.headerCta}><ProductLink location="header" /></div>
      </header>
      <main id="story-main">
        <section id="hero" className={`${styles.scene} ${styles.hero}`} aria-labelledby="story-title" data-story-scene="hero">
          <div className={styles.sceneCopy} data-story-reveal="text">
            <p className={styles.eyebrow}>{copy.hero_eyebrow}</p>
            <h1 id="story-title">{copy.hero_h1}</h1>
            <p className={styles.heroBody}>{copy.hero_body}</p>
            <ProductLink location="hero" />
            <p className={styles.note}>{copy.hero_note}</p>
          </div>
          <figure className={styles.heroVisual} data-hero-visual>
            <EvidenceConstellation />
            <div className={styles.visualLegend}><span>{copy.feature_3_h3}</span><span>{copy.feature_2_h3}</span><span>{copy.feature_5_h3}</span></div>
            <figcaption>{copy.opening_label}</figcaption>
          </figure>
        </section>
        <section id="problem" className={`${styles.scene} ${styles.problem}`} aria-labelledby="problem-title" data-story-scene="problem">
          <div className={styles.sceneCopy} data-story-reveal="text"><span className={styles.step} aria-hidden="true">01 / RR</span><h2 id="problem-title">{copy.problem_h2}</h2><p>{copy.problem_body}</p></div>
          <div className={styles.problemPath} aria-hidden="true"><span>{copy.feature_2_h3}</span><i /><FieldMark index={2} /><i /><span>{copy.feature_5_h3}</span></div>
        </section>
        <section id="signals" className={`${styles.scene} ${styles.signals}`} aria-labelledby="signals-title" data-story-scene="signals">
          <div className={styles.sectionTop}><span className={styles.step} aria-hidden="true">02 / RR</span><h2 id="signals-title">{copy.opening_label}</h2></div>
          <div className={styles.sequence}>
            {([
              [copy.opening_1_h2, copy.opening_1_body, "signal"],
              [copy.opening_2_h2, copy.opening_2_body, "context"],
              [copy.opening_3_h2, copy.opening_3_body, "assembled"],
            ] as const).map(([title, body, variant], index) => <article className={styles.sequencePanel} data-story-reveal="card" key={variant}><span className={styles.sequenceNumber} aria-hidden="true">0{index + 1}</span><PaperArt variant={variant} /><h3>{title}</h3><p>{body}</p></article>)}
          </div>
        </section>
        <section id="priority" className={styles.scene} aria-labelledby="priority-title" data-story-scene="priority">
          <div className={styles.sceneCopy} data-story-reveal="text"><span className={styles.step} aria-hidden="true">03 / RR</span><h2 id="priority-title">{copy.priority_h2}</h2><p>{copy.priority_body}</p></div>
          <figure className={styles.priorityVisual}>
            <PaperArt variant="priority" />
            <ol className={styles.priorityRail}>{[copy.feature_1_h3, copy.feature_4_h3, copy.feature_3_h3].map((label, index) => <li key={label}><span className={styles.railDot} aria-hidden="true" /><span>{label}</span><FieldMark index={index} /></li>)}</ol>
            <figcaption>{copy.priority_label}</figcaption>
          </figure>
          <p className={styles.demoDisclosure} data-demo-disclosure>{copy.opening_label}</p>
          <ScrollDemo />
        </section>
        <section id="contact" className={`${styles.scene} ${styles.dark}`} aria-labelledby="contact-title" data-story-scene="contact">
          <div className={styles.sceneCopy} data-story-reveal="text"><span className={styles.step} aria-hidden="true">04 / RR</span><h2 id="contact-title">{copy.contact_h2}</h2><p>{copy.contact_body}</p></div>
          <figure className={styles.letterVisual}>
            <PaperArt variant="contact" />
            <div className={styles.paper}><p className={styles.paperLabel}>{copy.contact_example_label}</p><blockquote>{copy.contact_example}</blockquote><p className={styles.note}>{copy.contact_example_note}</p></div>
          </figure>
        </section>
        <section id="card" className={`${styles.scene} ${styles.fieldsScene}`} aria-labelledby="card-title" data-story-scene="card">
          <div className={styles.sectionTop}><span className={styles.step} aria-hidden="true">05 / RR</span><h2 id="card-title">{copy.features_h2}</h2></div>
          <div className={styles.fieldGrid}>{fields.map(([title, body], index) => <article className={styles.field} data-story-reveal="card" key={title}><FieldMark index={index} /><div><span className={styles.fieldNumber} aria-hidden="true">0{index + 1}</span><h3>{title}</h3><p>{body}</p></div></article>)}</div>
        </section>
        <section id="boundary" className={`${styles.scene} ${styles.boundary}`} aria-labelledby="boundary-title" data-story-scene="boundary">
          <SceneHeading step="06" title={copy.boundary_h2} body={copy.boundary_positive} />
          <div className={styles.boundaryVisual}><div className={styles.responsibility}><div><FieldMark index={2} /><h3>{copy.feature_3_h3}</h3></div><div><FieldMark index={4} /><h3>{copy.feature_5_h3}</h3></div></div><p className={styles.boundaryNote}>{copy.boundary_note}</p><p>{copy.boundary_limits}</p></div>
        </section>
        <section id="closing" className={`${styles.scene} ${styles.closing}`} aria-labelledby="closing-title" data-story-scene="closing">
          <div className={styles.closingArt} aria-hidden="true"><FieldMark index={2} /><span /><FieldMark index={4} /></div>
          <h2 id="closing-title">{copy.closing_h2}</h2><p>{copy.closing_body}</p><ProductLink location="closing" /><p className={styles.note}>{copy.closing_note}</p>
        </section>
      </main>
      <footer className={styles.footer}><span>{copy.footer_copyright}</span><a href="https://recruiter-radar.ru/privacy">Конфиденциальность</a></footer>
    </div>
  );
}
