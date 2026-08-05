import { ActionGlyph, RouteGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_CONTACT_PATHS, DEMO_OUTREACH_COPY } from "./landing-copy";
import styles from "./landing.module.css";

export default function OutreachScene() {
  return (
    <section
      id="scene-outreach"
      className={`${styles.scene} ${styles.lightScene} ${styles.outreachScene}`}
      aria-labelledby="outreach-title"
      data-landing-scene="outreach"
    >
      <div className={styles.outreachLayout}>
        <div className={styles.outreachIntro}>
          <p className={styles.sceneLabel} data-system-label>04 — Действие</p>
          <h2 id="outreach-title" className={styles.sceneHeading}>
            Сначала причина для контакта. <em>Потом сообщение.</em>
          </h2>
          <p className={styles.sceneLead}>
            Радар собирает повод и безопасный корпоративный маршрут. Решение об обращении и отправка всегда остаются за человеком.
          </p>
        </div>

        <div className={styles.opportunityBrief}>
          <div className={styles.briefCoordinate}>
            <ActionGlyph size={68} />
            <span data-system-label>Рекомендация / сегодня</span>
          </div>
          <dl className={styles.briefFacts}>
            <div><dt>Компания</dt><dd>{DEMO_COMPANY.name}</dd></div>
            <div><dt>Ситуация</dt><dd>Ускорение инженерного найма и новая руководящая роль</dd></div>
            <div><dt>Почему сейчас</dt><dd>4 связанных события за 7 дней; последнее изменение — сегодня</dd></div>
            <div><dt>Подход</dt><dd>Точечный подбор по сложным инженерным ролям</dd></div>
          </dl>
          <div className={styles.contactPathBlock}>
            <span data-system-label>Корректный путь контакта</span>
            <ul className={styles.contactPaths}>
              {DEMO_CONTACT_PATHS.map((path, index) => (
                <li key={path}><span>{String(index + 1).padStart(2, "0")}</span><RouteGlyph size={15} />{path}</li>
              ))}
            </ul>
            <small>Только корпоративные каналы · без частных телефонов и email</small>
          </div>
        </div>

        <div className={styles.messageDraft}>
          <div className={styles.draftHeader}>
            <span data-draft-status>Черновик · не отправлено</span>
            <strong>Первое сообщение, основанное на факте</strong>
          </div>
          <blockquote>{DEMO_OUTREACH_COPY}</blockquote>
          <div className={styles.actionBoundary}>
            <div><span>Система обнаружила</span><strong>связанный сигнал найма</strong></div>
            <div><span>Система рекомендует</span><strong>точку входа и подход к разговору</strong></div>
            <div><span>Пользователь делает</span><strong>проверяет и отправляет вручную</strong></div>
          </div>
          <p>Recruiter Radar не отправляет сообщения компаниям автоматически.</p>
        </div>
      </div>
    </section>
  );
}
