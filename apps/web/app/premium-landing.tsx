import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getPaymentProviderSetupState } from "../lib/payments";
import {
  PUBLIC_PLANS,
  PUBLIC_PREVIEW_FIELD_LIMITS,
  buildCheckoutHref,
  buildPublicPreviewHref,
  getPublicSampleDigestState,
  hasPublicPreviewInput,
  readPublicPreviewInput,
  type PublicPreviewInput,
} from "../lib/publicProduct";
import { formatScorePoints, scorePercent } from "../lib/scoring/score-display";
import { deriveWhyNow, formatLawfulContactPath } from "../lib/leads-data";
import { formatVacanciesCount } from "../lib/format/plural";
import {
  buildFaqItems,
  cleanEmployerName,
  formatLocationCaption,
  formatVacancyFreshness,
  pickEvidenceTitles,
} from "./home-page-components";
import LandingHeader from "./landing-header";
import RadarCanvas from "./radar-canvas";
import ScrollProgress from "./scroll-progress";
import { NoticeBox, PageFrame, StatusBadge, SurfaceCard } from "./ui/page-primitives";
import ppStyles from "./ui/page-primitives.module.css";
import { SiteFooter } from "./ui/site-footer";

export const metadata: Metadata = {
  title: "Recruiter Radar — компании, которым нужен подбор прямо сейчас",
  description:
    "Evidence-first радар клиентских возможностей для рекрутинговых агентств: подтверждённые hiring signals, приоритет, доказательства и безопасный путь контакта.",
};

const PRESETS = [
  { label: "Инженерный подбор · Москва", specialization: "инженерный подбор", targetCity: "Москва" },
  { label: "IT-подбор · Россия", specialization: "IT-подбор", targetCity: "Россия" },
  { label: "Коммерческие роли · Петербург", specialization: "коммерческие роли", targetCity: "Санкт-Петербург" },
] as const;

export default async function PremiumLanding(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const previewInput = readPublicPreviewInput(searchParams);
  const checkoutHref = buildCheckoutHref(previewInput);
  const pilot = PUBLIC_PLANS.find((plan) => plan.code === "pilot") ?? PUBLIC_PLANS[0];
  const faqItems = buildFaqItems(getPaymentProviderSetupState().configured);

  return (
    <PageFrame maxWidth="1180px">
      <style>{LANDING_CSS}</style>
      <ScrollProgress />
      <div className="rr-ambient" aria-hidden="true"><span /></div>
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>

      <section id="main-content" className="rr-hero" aria-label="Recruiter Radar">
        <RadarCanvas />
        <span className="rr-hero-glow" aria-hidden="true" />
        <div className="rr-hero-grid">
          <div className="rr-hero-copy">
            <div className="rr-eyebrow"><i aria-hidden="true" />Evidence-first лидген для рекрутинговых агентств</div>
            <h1>Узнайте, кому нужен подбор — <em>раньше других агентств.</em></h1>
            <p className="rr-hero-lead">
              Recruiter Radar каждый день превращает hiring signals в короткий список компаний:
              что изменилось, почему писать сейчас и какой корпоративный путь контакта доступен.
            </p>
            <div className="rr-actions">
              <a href="#preview" className="rr-primary">Посмотреть свой радар <Arrow /></a>
              <Link href={checkoutHref} className="rr-secondary">Попробовать 7 дней</Link>
            </div>
            <p className="rr-fineprint">{pilot.price} · разовая оплата · без автопродления · решение об обращении всегда за вами</p>
          </div>

          <article className="rr-product" aria-label="Пример рекомендации Recruiter Radar">
            <div className="rr-product-top"><span>Рекомендация на сегодня</span><b>обезличенный пример</b></div>
            <div className="rr-company">
              <div><strong>Производственная компания</strong><span>Москва и область · промышленность</span></div>
              <div className="rr-score"><strong>87</strong><span>/100</span></div>
            </div>
            <div className="rr-score-track"><span /></div>
            <div className="rr-signal">
              <span>Что изменилось</span>
              <strong>14 новых вакансий за 6 дней</strong>
              <p>Появилась редкая инженерная роль, динамика подтверждена несколькими источниками.</p>
            </div>
            <div className="rr-proof-grid">
              <div><span>Почему сейчас</span><strong>Сигнал свежий</strong><p>Момент для первого касания ещё не потерян.</p></div>
              <div><span>Уверенность</span><strong>Gate A</strong><p>Подтверждённый найм и несколько независимых фактов.</p></div>
              <div><span>Следующий шаг</span><strong>Корпоративный канал</strong><p>Без персональных баз и автоматической рассылки.</p></div>
            </div>
          </article>
        </div>

        <div className="rr-trust-ribbon" aria-label="Ключевые свойства продукта">
          <div><strong>Доказательства в карточке</strong><span>Источники, свежесть и ограничения видны до контакта.</span></div>
          <div><strong>3–7 приоритетов в день</strong><span>Не ещё одна база, а короткая рабочая очередь для BD.</span></div>
          <div><strong>Россия-first источники</strong><span>hh.ru, Работа России, карьерные страницы и контекст компании.</span></div>
          <div><strong>Telegram-first доставка</strong><span>Также доступны email, web push, VK и webhook.</span></div>
        </div>
      </section>

      <LandingHeader activationHref={checkoutHref} />

      <Suspense fallback={<PreviewFallback />}>
        <LivePreview input={previewInput} checkoutHref={checkoutHref} />
      </Suspense>

      <section className="rr-section" aria-labelledby="outcome-title">
        <SectionHead
          eyebrow="Экономика канала"
          title="Меньше ручного ресёрча. Больше своевременных касаний."
          description="Радар не заменяет продажи агентства. Он убирает самую дорогую часть до первого сообщения: поиск момента и проверку, что спрос действительно есть."
          id="outcome-title"
        />
        <div className="rr-outcomes">
          <article><span>01</span><h3>Не реагируете на всё подряд</h3><p>Сначала видите компании с сильным сочетанием профиля, намерения нанимать, срочности и доступности контакта.</p></article>
          <article><span>02</span><h3>Пишете с конкретным поводом</h3><p>В карточке уже есть «что изменилось», «почему сейчас» и следующий безопасный шаг для первого касания.</p></article>
          <article><span>03</span><h3>Улучшаете выдачу обратной связью</h3><p>Отмечаете «беру», «позже» или «не подходит» — и радар постепенно точнее понимает ваш ICP.</p></article>
        </div>
      </section>

      <section id="quality" className="rr-quality" aria-labelledby="quality-title">
        <div className="rr-quality-copy">
          <span>Контракт доверия</span>
          <h2 id="quality-title">Сильный балл ничего не значит без понятных доказательств.</h2>
          <p>Поэтому Recruiter Radar показывает не только итоговый score. У каждой рекомендации есть уровень уверенности, факты, источники, свежесть и то, что нужно проверить до обращения.</p>
          <ul>
            <li><b>Соответствие:</b> ниша, роли, отрасль и география совпадают с профилем агентства.</li>
            <li><b>Намерение:</b> найм подтверждён не одним заголовком, а несколькими признаками.</li>
            <li><b>Срочность:</b> видно, насколько свежий сигнал и не потерян ли момент.</li>
            <li><b>Доступность:</b> используется законный корпоративный путь контакта.</li>
          </ul>
        </div>
        <div className="rr-gates" aria-label="Уровни уверенности">
          <article data-grade="A"><b>A</b><div><strong>Подтверждено</strong><p>Несколько независимых фактов и сильный hiring signal.</p></div></article>
          <article data-grade="B"><b>B</b><div><strong>Скорее подтверждено</strong><p>Сигнал рабочий, но часть контекста стоит проверить.</p></div></article>
          <article data-grade="C"><b>C</b><div><strong>Нужна проверка</strong><p>Есть основания для наблюдения, но не для уверенного касания.</p></div></article>
          <article data-grade="D"><b>D</b><div><strong>Только контекст</strong><p>Событие компании без прямого доказательства активного найма.</p></div></article>
          <p>В клиентскую выдачу проходят только уровни, разрешённые текущим evidence-контрактом продукта.</p>
        </div>
      </section>

      <section id="how-it-works" className="rr-section" aria-labelledby="steps-title">
        <SectionHead
          eyebrow="Как работает"
          title="Настраиваете один раз. Получаете приоритеты каждый день."
          description="Без внедрения CRM и без передачи радару права писать компаниям от вашего имени."
          id="steps-title"
        />
        <div className="rr-steps">
          <article><span>01 · Профиль</span><h3>Фиксируете свой ICP</h3><p>Специализация, роли, отрасли, география, ключевые слова и исключения.</p></article>
          <article><span>02 · Проверка</span><h3>Радар собирает сигналы</h3><p>Сопоставляет вакансии, карьерные страницы и корпоративный контекст, затем применяет confidence gates.</p></article>
          <article><span>03 · Работа</span><h3>Получаете короткий digest</h3><p>Компании, доказательства, почему сейчас, путь контакта и следующий шаг — в выбранном канале.</p></article>
        </div>
        <div className="rr-delivery">
          <span className="rr-telegram" aria-hidden="true"><TelegramIcon /></span>
          <div><strong>Утренний радар · 5 компаний</strong><span>Доставка по расписанию профиля</span></div>
          <p>Telegram — основной канал. Дополнительно можно подключить email, web push, VK или webhook. Сообщения компаниям продукт автоматически не отправляет.</p>
        </div>
      </section>

      <section id="pricing" className="rr-section" aria-labelledby="pricing-title">
        <SectionHead
          eyebrow="Тарифы"
          title="Проверьте канал за неделю. Продолжайте только на фактах."
          description="Во всех тарифах одинаковый продукт. Отличается только срок доступа. Пилот оплачивается один раз и не продлевается автоматически."
          id="pricing-title"
        />
        <div className="rr-pricing">
          {PUBLIC_PLANS.map((plan) => (
            <SurfaceCard key={plan.code} className={`rr-plan${plan.isPrimary ? " rr-plan-primary" : ""}`} padding="26px">
              <div className="rr-plan-head">
                <StatusBadge tone={plan.isPrimary ? "info" : "neutral"}>{plan.name}</StatusBadge>
                {plan.isPrimary ? <span>Начать здесь</span> : null}
              </div>
              <div className="rr-plan-price"><strong>{plan.price}</strong><span>{plan.cadence}</span></div>
              <p>{plan.description}</p>
              <div className="rr-plan-terms"><strong>{plan.isRecurring ? "Подключение по заявке" : "Разовая оплата"}</strong><span>Без автоматического списания</span></div>
              <Link href={buildCheckoutHref({ ...previewInput, planCode: plan.code })} className={plan.isPrimary ? ppStyles.primaryAction : ppStyles.secondaryAction}>{plan.ctaLabel}</Link>
            </SurfaceCard>
          ))}
        </div>
        <div className="rr-included">
          <div><span>В каждом тарифе</span><strong>Один evidence-first радар без урезанных функций</strong></div>
          <ul>{PUBLIC_PLANS[0].bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
          <p>Оплата через ЮKassa, чек по ФЗ-54. <Link href="/terms">Оферта</Link>. Ответ компании, закрытие вакансии и наличие high-confidence лида каждый день не гарантируются.</p>
        </div>
      </section>

      <section id="faq" className="rr-section" aria-labelledby="faq-title">
        <SectionHead eyebrow="FAQ" title="Что важно знать до запуска" description="Условия, ограничения и контроль пользователя — без мелкого шрифта после оплаты." id="faq-title" />
        <div className="rr-faq">
          {faqItems.map((item) => (
            <details key={item.question}>
              <summary><span>{item.question}</span><Chevron /></summary>
              <div>{item.answer}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="rr-closing">
        <span>Первый рабочий цикл</span>
        <h2>Получите первый радар и оцените качество на своих компаниях.</h2>
        <p>За семь дней станет понятно, даёт ли канал вашему агентству своевременные и объяснимые поводы для выхода на новых клиентов.</p>
        <div className="rr-actions">
          <Link href={checkoutHref} className="rr-primary">Активировать неделю — {pilot.price} <Arrow /></Link>
          <a href="#preview" className="rr-secondary">Сначала посмотреть пример</a>
        </div>
      </section>

      <SiteFooter />
    </PageFrame>
  );
}

async function LivePreview(props: { input: PublicPreviewInput; checkoutHref: string }) {
  const state = await getPublicSampleDigestState(props.input);
  const items = state.items.slice(0, 3);
  const personalized = hasPublicPreviewInput(props.input);

  return (
    <section id="preview" className="rr-section rr-preview" aria-labelledby="preview-title">
      <SectionHead
        eyebrow="Рабочий пример"
        title="Сначала посмотрите, что именно получите"
        description="Задайте нишу и географию. Приоритеты пересчитаются по тем же правилам, что используются в рабочей выдаче."
        id="preview-title"
      />
      <div className="rr-preview-shell">
        <SurfaceCard className="rr-preview-controls" padding="24px">
          <div><span>Настройка примера</span><h3>Два поля до первой выдачи</h3><p>Начните с готового профиля или укажите свой.</p></div>
          <div className="rr-presets">
            {PRESETS.map((preset) => <Link key={preset.label} href={buildPublicPreviewHref({ ...preset, dailyDigestLimit: props.input.dailyDigestLimit })}>{preset.label}</Link>)}
          </div>
          <form method="GET" action="/#preview" className="rr-preview-form">
            <label className={ppStyles.field} htmlFor="specialization"><span className={ppStyles.fieldLabel}>Специализация</span><input id="specialization" name="specialization" defaultValue={props.input.specialization} maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.specialization} placeholder="Промышленный подбор" className={ppStyles.input} /></label>
            <label className={ppStyles.field} htmlFor="targetCity"><span className={ppStyles.fieldLabel}>География</span><input id="targetCity" name="targetCity" defaultValue={props.input.targetCity} maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.targetCity} placeholder="Москва / Россия" className={ppStyles.input} /></label>
            <input type="hidden" name="dailyDigestLimit" value={props.input.dailyDigestLimit} />
            <button type="submit" className={ppStyles.primaryAction}>Пересчитать радар</button>
          </form>
        </SurfaceCard>

        <div className="rr-preview-results">
          <div className="rr-preview-head">
            <div><h3>{personalized ? "Радар под ваш профиль" : "Пример утренней выдачи"}</h3><span>{items.length} компании в открытом примере</span></div>
            <StatusBadge tone={state.isLive ? "success" : "neutral"}>{state.isLive ? "актуальные данные" : "примерные данные"}</StatusBadge>
          </div>
          {!state.isLive ? <div className="rr-sample-note"><strong>Обезличенный набор</strong><span>Названия и факты примерные. Логика ранжирования и уровни уверенности соответствуют рабочему продукту.</span></div> : null}
          {items.length === 0 ? <NoticeBox title="Совпадений пока нет" description="Расширьте географию или сделайте специализацию менее узкой." /> : items.map((item) => <LeadCard key={`${item.org_id}-${item.rank}`} item={item} />)}
          <Link href={props.checkoutHref} className={ppStyles.primaryAction}>Получать такой радар каждый день</Link>
        </div>
      </div>
    </section>
  );
}

function LeadCard({ item }: { item: Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number] }) {
  const score = formatScorePoints(item.total_score);
  const pct = scorePercent(item.total_score);
  const whyNow = deriveWhyNow(item.reasons) || formatVacanciesCount(item.vacancies_count);
  const location = formatLocationCaption(item.location_names);
  const freshness = formatVacancyFreshness(item.latest_published_at);
  const contact = formatLawfulContactPath(item.lawfulContactPath) || "Корпоративный путь нужно уточнить";
  const evidence = pickEvidenceTitles(item.evidence_titles, 3);

  return (
    <article className="rr-lead">
      <div className="rr-lead-head"><div><strong>{cleanEmployerName(item.employer_name)}</strong><span>{[location, freshness].filter(Boolean).join(" · ")}</span></div><div><strong>{score}</strong><span>/100</span></div></div>
      <div className="rr-lead-bar"><span style={{ width: `${pct}%` }} /></div>
      <div className="rr-lead-facts">
        <div><span>Что изменилось</span><p>{whyNow}</p></div>
        <div><span>Уверенность</span><p>{gateLabel(item.confidence_gate)} · {item.sourceCount} источника</p></div>
        <div><span>Путь контакта</span><p>{contact}</p></div>
      </div>
      {evidence.length > 0 ? <p className="rr-evidence">Факты: {evidence.join(" · ")}</p> : null}
      <div className="rr-next"><span>Следующий шаг</span><strong>{item.opener?.trim() || "Проверить контекст и подготовить точечное первое касание"}</strong></div>
    </article>
  );
}

function PreviewFallback() {
  return (
    <section id="preview" className="rr-section rr-preview">
      <SectionHead eyebrow="Рабочий пример" title="Собираем актуальную выдачу" description="Профиль и остальные разделы страницы уже доступны; данные радара подгружаются отдельно." id="preview-loading-title" />
      <div className="rr-skeleton"><span /><span /><span /></div>
    </section>
  );
}

function SectionHead(props: { eyebrow: string; title: string; description: string; id: string }) {
  return <div className="rr-section-head"><span>{props.eyebrow}</span><h2 id={props.id}>{props.title}</h2><p>{props.description}</p></div>;
}

function gateLabel(gate: string | null | undefined) {
  if (gate === "A") return "Подтверждено";
  if (gate === "B") return "Скорее подтверждено";
  if (gate === "C") return "Нужна проверка";
  if (gate === "D") return "Контекст без прямого найма";
  return "Уровень не указан";
}

function Arrow() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

function Chevron() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}

function TelegramIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 4 3.8 10.3c-1.1.4-1.1 1.1-.2 1.4l4.1 1.3 1.6 4.8c.2.6.1.8.8.8.5 0 .8-.2 1-.4l2-1.9 4.2 3.1c.8.4 1.3.2 1.5-.7L21.5 5c.3-1-.4-1.4-1.5-1Z" fill="currentColor" /></svg>;
}

const LANDING_CSS = String.raw`
.rr-ambient{position:fixed;inset:0;z-index:-2;overflow:hidden;pointer-events:none;background:radial-gradient(circle at 8% 7%,rgba(61,104,202,.18),transparent 29%),radial-gradient(circle at 91% 48%,rgba(165,113,58,.12),transparent 28%),linear-gradient(180deg,#e9eef5 0%,#f6f8fb 48%,#e8edf4 100%)}
.rr-ambient span{position:absolute;inset:0;opacity:.5;background-image:linear-gradient(rgba(30,52,87,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(30,52,87,.035) 1px,transparent 1px);background-size:72px 72px;mask-image:linear-gradient(to bottom,#000 0%,rgba(0,0,0,.45) 65%,transparent 100%)}
.rr-hero{position:relative;isolation:isolate;overflow:hidden;min-height:calc(100svh - 48px);display:grid;align-content:center;gap:34px;padding:clamp(44px,6vw,76px) clamp(24px,5.8vw,72px) clamp(25px,3vw,36px);margin-bottom:14px;border:1px solid rgba(151,171,204,.16);border-radius:28px;color:#f8fbff;background:linear-gradient(130deg,rgba(12,21,38,.97),rgba(11,22,42,.94)),#0b1426;box-shadow:0 34px 86px rgba(5,12,26,.3)}
.rr-hero:before{position:absolute;inset:0;z-index:0;content:"";background:linear-gradient(90deg,rgba(8,16,30,.9),rgba(8,16,30,.72) 48%,rgba(8,16,30,.25)),radial-gradient(circle at 76% 42%,rgba(68,109,220,.18),transparent 42%);pointer-events:none}.rr-hero-glow{position:absolute;z-index:0;right:7%;bottom:-52%;width:720px;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,rgba(170,118,59,.18),transparent 68%);filter:blur(18px)}
.rr-hero-grid{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,1.03fr) minmax(390px,.97fr);gap:clamp(38px,6vw,82px);align-items:center}.rr-hero-copy{display:grid;gap:22px}.rr-eyebrow,.rr-section-head>span,.rr-preview-controls>div:first-child>span,.rr-quality-copy>span,.rr-closing>span{display:inline-flex;align-items:center;gap:10px;color:#9fc2ff;font-size:.71rem;font-weight:850;letter-spacing:.09em;text-transform:uppercase}.rr-eyebrow i{width:7px;height:7px;border-radius:50%;background:#78a6ff;box-shadow:0 0 0 5px rgba(120,166,255,.12)}
.rr-hero h1{max-width:11.8ch;margin:0;color:#fff;font-size:clamp(3.25rem,5.7vw,6.2rem);line-height:.96;font-weight:710;letter-spacing:-.064em;text-wrap:balance}.rr-hero h1 em{color:#9cc2ff;font-style:normal}.rr-hero-lead{max-width:57ch;margin:0;color:rgba(218,228,242,.76);font-size:clamp(1.03rem,1.35vw,1.18rem);line-height:1.65}.rr-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.rr-primary,.rr-secondary{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:50px;box-sizing:border-box;padding:0 22px;border-radius:13px;font-size:.94rem;font-weight:780;text-decoration:none;transition:transform .16s ease,box-shadow .18s ease,border-color .18s ease,background .18s ease}.rr-primary{border:1px solid rgba(255,255,255,.32);color:#0d1728;background:#fff;box-shadow:0 16px 38px rgba(1,5,14,.38)}.rr-primary:hover{transform:translateY(-2px);box-shadow:0 22px 48px rgba(1,5,14,.46)}.rr-secondary{border:1px solid rgba(211,224,241,.2);color:rgba(242,247,253,.9);background:rgba(255,255,255,.035)}.rr-secondary:hover{border-color:rgba(211,224,241,.34);background:rgba(255,255,255,.07)}.rr-primary svg,.rr-secondary svg,.rr-faq summary svg{width:17px;height:17px;flex:0 0 auto}.rr-fineprint{margin:-8px 0 0;color:rgba(180,197,220,.76);font-size:.78rem}
.rr-product{display:grid;gap:18px;min-width:0;padding:clamp(22px,2.6vw,30px);border:1px solid rgba(153,177,214,.2);border-radius:22px;background:radial-gradient(circle at 92% 8%,rgba(81,125,229,.16),transparent 34%),rgba(13,26,48,.9);box-shadow:0 28px 72px rgba(1,6,17,.34);backdrop-filter:blur(14px)}.rr-product-top,.rr-company,.rr-preview-head,.rr-lead-head,.rr-plan-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.rr-product-top>span{color:rgba(191,207,231,.68);font-size:.68rem;font-weight:820;letter-spacing:.085em;text-transform:uppercase}.rr-product-top>b{padding:5px 9px;border:1px solid rgba(140,176,238,.2);border-radius:999px;color:#bed5ff;background:rgba(82,125,213,.1);font-size:.63rem;white-space:nowrap}.rr-company>div:first-child{display:grid;gap:4px}.rr-company strong{color:#fff;font-size:1.18rem}.rr-company span{color:rgba(178,196,219,.68);font-size:.74rem}.rr-score{display:inline-flex;align-items:baseline}.rr-score strong{font-size:2rem}.rr-score span{color:rgba(176,194,217,.55);font-size:.72rem}.rr-score-track,.rr-lead-bar{height:5px;overflow:hidden;border-radius:999px;background:rgba(154,177,208,.14)}.rr-score-track span,.rr-lead-bar span{display:block;width:87%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#4d78d0,#8fb5ff)}.rr-signal{display:grid;gap:7px;padding:17px;border:1px solid rgba(151,174,210,.13);border-radius:15px;background:rgba(4,12,25,.28)}.rr-signal span,.rr-proof-grid span,.rr-lead-facts span,.rr-next span{color:#91b6f5;font-size:.64rem;font-weight:850;letter-spacing:.075em;text-transform:uppercase}.rr-signal strong{font-size:1.03rem}.rr-signal p,.rr-proof-grid p{margin:0;color:rgba(199,213,232,.7);font-size:.74rem;line-height:1.5}.rr-proof-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.rr-proof-grid>div{display:grid;gap:6px;min-width:0;padding:13px;border:1px solid rgba(151,174,210,.13);border-radius:13px;background:rgba(255,255,255,.025)}.rr-proof-grid strong{font-size:.78rem}
.rr-trust-ribbon{position:relative;z-index:2;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid rgba(156,178,209,.14)}.rr-trust-ribbon>div{display:grid;gap:4px;min-width:0;padding:20px clamp(12px,2vw,24px) 2px;border-right:1px solid rgba(156,178,209,.12)}.rr-trust-ribbon>div:last-child{border-right:0}.rr-trust-ribbon strong{font-size:.81rem}.rr-trust-ribbon span{color:rgba(177,194,217,.65);font-size:.67rem;line-height:1.45}
.rr-section{display:grid;gap:24px;padding:clamp(28px,4vw,48px) 0;scroll-margin-top:96px}.rr-preview{padding-top:clamp(34px,5vw,62px)}.rr-section-head{display:grid;gap:10px;max-width:820px}.rr-section-head>span{color:#3564c9}.rr-section-head h2{max-width:23ch;margin:0;color:#13213a;font-size:clamp(2rem,4.3vw,4.2rem);line-height:1.02;letter-spacing:-.052em;text-wrap:balance}.rr-section-head p{max-width:70ch;margin:0;color:#607087;font-size:.96rem;line-height:1.65}
.rr-preview-shell{display:grid;grid-template-columns:minmax(280px,.7fr) minmax(0,1.3fr);gap:18px;align-items:start}.rr-preview-controls{position:sticky;top:92px;display:grid;gap:19px;border:1px solid rgba(33,66,117,.12);background:rgba(255,255,255,.97);box-shadow:0 20px 54px rgba(20,39,74,.08)}.rr-preview-controls>div:first-child{display:grid;gap:7px}.rr-preview-controls>div:first-child>span{color:#3564c9}.rr-preview-controls h3,.rr-preview-head h3{margin:0;color:#13213a;font-size:1.3rem;letter-spacing:-.035em}.rr-preview-controls p,.rr-preview-head span{margin:0;color:#69788d;font-size:.76rem;line-height:1.5}.rr-presets{display:flex;flex-wrap:wrap;gap:7px}.rr-presets a{padding:7px 9px;border:1px solid rgba(43,91,188,.15);border-radius:999px;color:#3157aa;background:rgba(52,95,185,.055);font-size:.66rem;font-weight:730;text-decoration:none}.rr-preview-form{display:grid;gap:13px}.rr-preview-results{display:grid;gap:14px;min-width:0;padding:clamp(22px,3vw,30px);border:1px solid rgba(33,66,117,.13);border-radius:22px;background:rgba(255,255,255,.97);box-shadow:0 22px 64px rgba(20,39,74,.09)}.rr-preview-head>div{display:grid;gap:4px}.rr-sample-note{display:grid;grid-template-columns:minmax(140px,.35fr) minmax(0,1.65fr);gap:16px;padding:12px 0;border-top:1px solid rgba(31,62,110,.11);border-bottom:1px solid rgba(31,62,110,.11)}.rr-sample-note strong{color:#17243b;font-size:.75rem}.rr-sample-note span{color:#6b7a90;font-size:.75rem;line-height:1.5}.rr-lead{display:grid;gap:14px;padding:19px;border:1px solid rgba(144,165,197,.2);border-radius:16px;color:#f8fbff;background:radial-gradient(circle at 90% 0%,rgba(76,124,205,.15),transparent 34%),linear-gradient(150deg,#17243a,#101a2c);box-shadow:0 14px 32px rgba(15,23,42,.13)}.rr-lead-head>div:first-child{display:grid;gap:4px}.rr-lead-head>div:first-child>strong{font-size:.94rem}.rr-lead-head>div:first-child>span{color:#9aabc1;font-size:.69rem}.rr-lead-head>div:last-child{display:inline-flex;align-items:baseline;padding:8px 10px;border:1px solid rgba(148,163,184,.2);border-radius:10px;background:rgba(255,255,255,.055)}.rr-lead-head>div:last-child strong{font-size:1rem}.rr-lead-head>div:last-child span{color:#9aabc1;font-size:.62rem}.rr-lead-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.rr-lead-facts>div{padding:12px;border:1px solid rgba(148,163,184,.13);border-radius:11px;background:rgba(5,12,24,.3)}.rr-lead-facts p{margin:6px 0 0;color:#dce5f0;font-size:.73rem;line-height:1.48}.rr-evidence{margin:0;padding:11px 0;border-top:1px solid rgba(148,163,184,.12);border-bottom:1px solid rgba(148,163,184,.12);color:#b8c6d8;font-size:.71rem;line-height:1.5}.rr-next{display:grid;gap:5px}.rr-next strong{font-size:.82rem;line-height:1.45}.rr-skeleton{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.rr-skeleton span{height:160px;border-radius:17px;background:linear-gradient(90deg,rgba(15,23,42,.05),rgba(15,23,42,.1),rgba(15,23,42,.05));background-size:200% 100%;animation:rr-shimmer 1.5s ease-in-out infinite}@keyframes rr-shimmer{to{background-position:-200% 0}}
.rr-outcomes,.rr-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:hidden;border-top:1px solid rgba(31,62,110,.13);border-bottom:1px solid rgba(31,62,110,.13)}.rr-outcomes article,.rr-steps article{display:grid;gap:10px;padding:28px clamp(20px,3vw,34px);border-right:1px solid rgba(31,62,110,.12)}.rr-outcomes article:last-child,.rr-steps article:last-child{border-right:0}.rr-outcomes span,.rr-steps span{color:#3564c9;font-size:.69rem;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.rr-outcomes h3,.rr-steps h3{margin:0;color:#14223a;font-size:1.07rem}.rr-outcomes p,.rr-steps p{margin:0;color:#607087;font-size:.84rem;line-height:1.58}
.rr-quality{display:grid;grid-template-columns:minmax(0,1.02fr) minmax(360px,.98fr);gap:clamp(32px,6vw,76px);padding:clamp(34px,5vw,58px);margin:28px 0;border:1px solid rgba(150,173,207,.15);border-radius:26px;color:#f8fbff;background:radial-gradient(circle at 90% 4%,rgba(64,111,221,.17),transparent 32%),linear-gradient(145deg,#101b2f,#091321);box-shadow:0 28px 70px rgba(8,17,32,.22)}.rr-quality-copy{display:grid;gap:16px;align-content:start}.rr-quality-copy h2{margin:0;font-size:clamp(2.1rem,4.3vw,4.1rem);line-height:1.02;letter-spacing:-.052em}.rr-quality-copy>p{margin:0;color:rgba(207,220,238,.7);font-size:.91rem;line-height:1.65}.rr-quality-copy ul{display:grid;gap:9px;margin:4px 0 0;padding:0;list-style:none}.rr-quality-copy li{padding:11px 0;border-top:1px solid rgba(157,181,215,.12);color:rgba(207,220,238,.72);font-size:.78rem;line-height:1.5}.rr-quality-copy li b{color:#f6f9ff}.rr-gates{display:grid;gap:9px}.rr-gates article{display:grid;grid-template-columns:52px 1fr;gap:14px;align-items:center;padding:14px;border:1px solid rgba(153,177,212,.13);border-radius:14px;background:rgba(255,255,255,.035)}.rr-gates article>b{display:grid;place-items:center;width:43px;height:43px;border-radius:12px;color:#b9d0ff;background:rgba(75,116,205,.17)}.rr-gates article[data-grade=A]>b{color:#8bf0bc;background:rgba(46,173,112,.15)}.rr-gates article[data-grade=C]>b{color:#f1ce89;background:rgba(172,113,35,.15)}.rr-gates strong{font-size:.86rem}.rr-gates p{margin:4px 0 0;color:rgba(204,217,235,.68);font-size:.72rem;line-height:1.5}.rr-gates>p{margin:3px 0 0;color:rgba(187,202,223,.58);font-size:.68rem;line-height:1.5}
.rr-delivery{display:grid;grid-template-columns:auto minmax(210px,.7fr) minmax(0,1.3fr);gap:18px;align-items:center;padding:20px 22px;border:1px solid rgba(31,62,110,.12);border-radius:17px;background:rgba(255,255,255,.93);box-shadow:0 12px 36px rgba(20,39,74,.06)}.rr-telegram{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;color:#fff;background:linear-gradient(145deg,#31a9e9,#207fc3);box-shadow:0 10px 24px rgba(31,149,214,.24)}.rr-telegram svg{width:23px;height:23px}.rr-delivery>div{display:grid;gap:4px}.rr-delivery span{color:#68778d;font-size:.68rem}.rr-delivery strong{color:#16243b;font-size:.81rem}.rr-delivery p{margin:0;color:#607087;font-size:.76rem;line-height:1.52}
.rr-pricing{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.rr-plan{position:relative;display:grid;gap:16px;min-width:0;border:1px solid rgba(31,62,110,.12);background:rgba(255,255,255,.97);box-shadow:0 12px 36px rgba(20,39,74,.06)}.rr-plan-primary{border-color:rgba(48,93,190,.3);background:linear-gradient(180deg,rgba(255,255,255,.99),rgba(238,244,255,.98));box-shadow:0 18px 46px rgba(41,84,177,.14)}.rr-plan-primary:before{position:absolute;inset:0 0 auto;height:3px;content:"";background:linear-gradient(90deg,#315fc8,#79a5ff)}.rr-plan-head>span{padding:5px 9px;border-radius:999px;color:#fff;background:#315fc8;font-size:.65rem;font-weight:800}.rr-plan-price{display:grid;gap:4px}.rr-plan-price strong{color:#14223a;font-size:clamp(1.7rem,3vw,2.4rem);letter-spacing:-.045em}.rr-plan-price span{color:#6b7a90;font-size:.7rem}.rr-plan>p{margin:0;color:#607087;font-size:.82rem;line-height:1.58}.rr-plan-terms{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid rgba(31,62,110,.1);border-bottom:1px solid rgba(31,62,110,.1)}.rr-plan-terms strong{color:#14223a;font-size:.73rem}.rr-plan-terms span{color:#7b899d;font-size:.65rem;text-align:right}.rr-plan>a{margin-top:auto}.rr-included{display:grid;grid-template-columns:minmax(190px,.38fr) minmax(0,1.62fr);gap:22px 34px;padding:26px 28px;border:1px solid rgba(31,62,110,.12);border-radius:18px;background:rgba(248,250,253,.95)}.rr-included>div{display:grid;gap:6px;align-content:start}.rr-included>div span{color:#3564c9;font-size:.67rem;font-weight:880;letter-spacing:.08em;text-transform:uppercase}.rr-included>div strong{color:#16243b;font-size:.98rem}.rr-included ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 24px;margin:0;padding:0;list-style:none}.rr-included li{position:relative;padding-left:18px;color:#5f6f86;font-size:.77rem;line-height:1.48}.rr-included li:before{position:absolute;left:0;top:.52em;width:8px;height:4px;border-left:2px solid #3564c9;border-bottom:2px solid #3564c9;content:"";transform:rotate(-45deg)}.rr-included>p{grid-column:1/-1;margin:0;padding-top:12px;border-top:1px solid rgba(31,62,110,.1);color:#7a889c;font-size:.7rem}.rr-included>p a{color:#315fc8}
.rr-faq{display:grid;gap:10px}.rr-faq details{overflow:hidden;padding:0 24px;border:1px solid rgba(31,62,110,.12);border-radius:15px;background:rgba(255,255,255,.97);box-shadow:0 8px 24px rgba(20,39,74,.045)}.rr-faq summary{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:68px;color:#17243b;cursor:pointer;font-size:.92rem;font-weight:760;list-style:none}.rr-faq summary::-webkit-details-marker{display:none}.rr-faq summary svg{color:#7c8b9f;transition:transform .18s ease}.rr-faq details[open] summary svg{transform:rotate(180deg);color:#315fc8}.rr-faq details>div{max-width:76ch;padding:0 0 20px;color:#607087;font-size:.84rem;line-height:1.62}
.rr-closing{display:grid;gap:18px;justify-items:center;padding:clamp(38px,6vw,66px) clamp(24px,5vw,56px);margin-top:28px;border:1px solid rgba(148,170,204,.14);border-radius:26px;color:#f8fbff;text-align:center;background:radial-gradient(circle at 50% 120%,rgba(76,121,220,.2),transparent 44%),#0b1426;box-shadow:0 28px 72px rgba(6,13,27,.22)}.rr-closing h2{max-width:21ch;margin:0;font-size:clamp(2rem,4vw,3.8rem);line-height:1.03;letter-spacing:-.052em;text-wrap:balance}.rr-closing>p{max-width:58ch;margin:0;color:rgba(207,220,238,.72);font-size:.92rem;line-height:1.62}.rr-closing .rr-actions{justify-content:center}
@media(max-width:1040px){.rr-hero-grid,.rr-preview-shell,.rr-quality{grid-template-columns:1fr}.rr-hero h1{max-width:13ch}.rr-product{max-width:760px}.rr-trust-ribbon{grid-template-columns:repeat(2,1fr)}.rr-preview-controls{position:static}.rr-pricing{grid-template-columns:1fr}}
@media(max-width:820px){.rr-hero{min-height:0;padding:40px 24px 24px}.rr-hero h1{font-size:clamp(2.75rem,10vw,4.6rem)}.rr-proof-grid,.rr-lead-facts,.rr-outcomes,.rr-steps,.rr-skeleton{grid-template-columns:1fr}.rr-outcomes article,.rr-steps article{border-right:0;border-bottom:1px solid rgba(31,62,110,.11)}.rr-outcomes article:last-child,.rr-steps article:last-child{border-bottom:0}.rr-delivery{grid-template-columns:auto 1fr}.rr-delivery p{grid-column:1/-1}.rr-included{grid-template-columns:1fr}.rr-included ul{grid-template-columns:1fr}.rr-included>p{grid-column:auto}}
@media(max-width:600px){.rr-hero{border-radius:20px;padding:32px 18px 22px;gap:26px}.rr-hero-grid{gap:28px}.rr-hero-copy{gap:18px}.rr-hero h1{max-width:none;font-size:clamp(2.25rem,11.3vw,3.5rem);line-height:.99}.rr-hero-lead{font-size:.93rem}.rr-actions,.rr-actions>*{width:100%}.rr-product{gap:14px;padding:17px;border-radius:17px}.rr-product-top,.rr-company,.rr-preview-head,.rr-lead-head,.rr-plan-head{align-items:flex-start}.rr-product-top{flex-direction:column;gap:8px}.rr-trust-ribbon{grid-template-columns:1fr}.rr-trust-ribbon>div{padding:14px 0;border-right:0;border-bottom:1px solid rgba(156,178,209,.12)}.rr-section{padding:30px 0;gap:19px}.rr-preview-controls,.rr-preview-results{padding:18px;border-radius:17px}.rr-sample-note{grid-template-columns:1fr;gap:5px}.rr-lead{padding:16px}.rr-quality{padding:28px 18px;border-radius:20px}.rr-quality-copy h2{font-size:clamp(2rem,11vw,3rem)}.rr-gates article{grid-template-columns:46px 1fr;padding:13px}.rr-delivery{padding:17px}.rr-included{padding:20px}.rr-faq details{padding-inline:18px}.rr-faq summary{min-height:62px;font-size:.85rem}.rr-closing{padding:36px 18px;border-radius:20px}}
@media(prefers-reduced-motion:reduce){.rr-primary,.rr-secondary,.rr-faq summary svg{transition:none}.rr-skeleton span{animation:none}}
`;
