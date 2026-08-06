import { ActionGlyph, RouteGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_CONTACT_PATHS, DEMO_OUTREACH_COPY } from "./landing-copy";
import styles from "./landing.module.css";

export default function OutreachScene() {
  return (
    <section
      id="scene-outreach"
      className={`${styles.scene} ${styles.lightScene} ${styles.outreachScene}`}
      aria-labelledby="outreach-title"
      data-header-tone="light"
    >
      <div className={styles.outreachLayout}>
        <div className={styles.outreachIntro}>
          <p className={styles.sceneLabel}>06 — Обращение</p>
          <h2 id="outreach-title" className={styles.sceneHeading}>
            Сначала причина для контакта. <em>Потом сообщение.</em>
          </h2>
          <p className={styles.sceneLead}>
            Радар собирает краткое описание возможности, рекомендуемый угол разговора и официальный маршрут. Решение об обращении и отправка всегда остаются за человеком.
          </p>
        </div>

        <div className={styles.outreachWorkspace}>
          <div className={styles.opportunityBrief}>
            <div className={styles.briefCoordinate}>
              <ActionGlyph size={58} />
              <div><span>Краткая карточка / сегодня</span><strong>{DEMO_COMPANY.name}</strong></div>
            </div>
            <dl className={styles.briefFacts}>
              <div><dt>Ситуация</dt><dd>{DEMO_COMPANY.change}</dd></div>
              <div><dt>Почему сейчас</dt><dd>{DEMO_COMPANY.whyNow}</dd></div>
              <div><dt>Угол разговора</dt><dd>Точечный подбор по сложным инженерным ролям и руководителям направления.</dd></div>
            </dl>
            <div className={styles.contactPathBlock}>
              <span>Корпоративный путь контакта</span>
              <ul className={styles.contactPaths}>
                {DEMO_CONTACT_PATHS.map((path, index) => (
                  <li key={path}><span>{String(index + 1).padStart(2, "0")}</span><RouteGlyph size={15} />{path}</li>
                ))}
              </ul>
              <small>Только корпоративные каналы · без частных телефонов и личных адресов электронной почты</small>
            </div>
          </div>

          <div className={styles.messageDraft}>
            <div className={styles.draftHeader}>
              <span>ЧЕРНОВИК / НЕ ОТПРАВЛЕНО</span>
              <strong>Пример первого сообщения, основанного на факте</strong>
            </div>
            <blockquote>{DEMO_OUTREACH_COPY}</blockquote>
            <div className={styles.actionBoundary}>
              <div><span>Система обнаружила</span><strong>связанный сигнал найма</strong></div>
              <div><span>Система рекомендует</span><strong>точку входа и угол разговора</strong></div>
              <div><span>Пользователь делает</span><strong>проверяет и отправляет вручную</strong></div>
            </div>
            <p>Recruiter Radar не отправляет сообщения компаниям автоматически.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
