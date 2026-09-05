import sceneStyles from "./detection-scene.module.css";

const NAV_ITEMS = [
  { label: "Сегодня", meta: "10", active: true },
  { label: "Компании", meta: "", active: false },
  { label: "Ситуации", meta: "2", active: false },
  { label: "Радар", meta: "", active: false },
  { label: "Настройки", meta: "", active: false },
] as const;

const LEADS = [
  { rank: "01", company: "Промет", reason: "14 инженерных вакансий", confidence: "A", active: true },
  { rank: "02", company: "Северные системы", reason: "Открыт новый регион", confidence: "B", active: false },
  { rank: "03", company: "Техноформ", reason: "Редкие роли в найме", confidence: "B", active: false },
] as const;

/**
 * Static, clearly-labeled workspace illustration for the hero (concept 2).
 * Deliberately NOT real-time data: the fixed demo date is visible in the
 * browser rail and the accessible name. Server component: zero JS cost.
 */
export default function HeroProductPreview() {
  return (
    <figure
      className={sceneStyles.productShot}
      data-hero-product-preview="demo"
      data-hero-workspace="today"
      role="img"
      aria-label="Демо рабочего кабинета Recruiter Radar от 12 мая: разделы Сегодня, Компании, Ситуации, Радар и Настройки; список компаний; выбранная карточка с причиной, источником, официальным контактом и ручными действиями."
    >
      <div className={sceneStyles.shotBar} aria-hidden="true">
        <span className={sceneStyles.shotDot} data-shot-dot="red" />
        <span className={sceneStyles.shotDot} data-shot-dot="yellow" />
        <span className={sceneStyles.shotDot} data-shot-dot="green" />
        <span className={sceneStyles.shotTitle}>Recruiter Radar</span>
        <span className={sceneStyles.shotDemoTag}>Демо · 12 мая</span>
      </div>
      <div className={sceneStyles.shotBody} aria-hidden="true">
        <aside className={sceneStyles.shotSide}>
          <div className={sceneStyles.shotSideBrand}>
            <span>RR</span>
            <strong>Рабочий кабинет</strong>
          </div>
          <div className={sceneStyles.shotNav}>
            {NAV_ITEMS.map((item, index) => (
              <span
                key={item.label}
                className={item.active ? sceneStyles.shotNavActive : undefined}
                data-hero-nav-item={item.label.toLowerCase()}
              >
                <i>{String(index + 1).padStart(2, "0")}</i>
                <b>{item.label}</b>
                {item.meta ? <em>{item.meta}</em> : null}
              </span>
            ))}
          </div>
          <div className={sceneStyles.shotProfile}>
            <span>Профиль</span>
            <strong>Инженерный подбор</strong>
            <small>Москва и область</small>
          </div>
        </aside>

        <div className={sceneStyles.shotWorkspace}>
          <header className={sceneStyles.shotWorkspaceHeader}>
            <div>
              <span>Сегодня</span>
              <strong>Компании, которым стоит написать</strong>
            </div>
            <small>Демо-профиль · 12 мая</small>
          </header>

          <div className={sceneStyles.shotSummary}>
            <span><strong>10</strong> в списке</span>
            <span><strong>3</strong> новых сигнала</span>
            <span><strong>2</strong> на проверке</span>
          </div>

          <div className={sceneStyles.shotWorkspaceGrid}>
            <ol className={sceneStyles.shotLeadList}>
              {LEADS.map((lead) => (
                <li key={lead.rank} className={lead.active ? sceneStyles.shotLeadActive : undefined}>
                  <span>{lead.rank}</span>
                  <div><strong>{lead.company}</strong><small>{lead.reason}</small></div>
                  <b>{lead.confidence}</b>
                </li>
              ))}
            </ol>

            <article className={sceneStyles.shotDetail} data-hero-company-detail="selected">
              <div className={sceneStyles.shotDetailHeader}>
                <div><span>Выбрано из списка</span><strong>Промет</strong></div>
              </div>
              <div className={sceneStyles.shotWhy} data-hero-why-now="true">
                <span>Почему сейчас</span>
                <p>Открыты 14 инженерных вакансий; расширение производства подтверждено карьерной страницей.</p>
              </div>
              <dl className={sceneStyles.shotEvidence} data-hero-evidence="fixed-date">
                <div><dt>Источник и дата</dt><dd>Карьерная страница · 12 мая</dd></div>
                <div><dt>Официальный контакт</dt><dd>Раздел вакансий компании</dd></div>
              </dl>
              <div className={sceneStyles.shotConfidence} data-hero-confidence="A">
                <span>Уверенность</span>
                <strong>A · высокая</strong>
              </div>
              <div className={sceneStyles.shotNext} data-hero-next-step="manual">
                <span>Следующий ход</span>
                <strong>Предложить точечный подбор по инженерным ролям</strong>
              </div>
              <div className={sceneStyles.shotActions}>
                <span className={sceneStyles.shotActionPrimary}>В работу</span>
                <span>Отложить</span>
                <span>Не подходит</span>
              </div>
            </article>
          </div>
        </div>
      </div>
    </figure>
  );
}
