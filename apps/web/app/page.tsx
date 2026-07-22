import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getPaymentProviderSetupState } from "../lib/payments";
import {
  PUBLIC_PLANS,
  buildCheckoutHref,
  hasPublicPreviewInput,
  readPublicPreviewInput,
} from "../lib/publicProduct";
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
} from "./ui/page-primitives";
import ppStyles from "./ui/page-primitives.module.css";
import {
  buildFaqItems,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";
import LandingAnalytics from "./landing-analytics";
import LandingHeader from "./landing-header";
import LandingHeroDemo from "./landing-hero-demo";
import LandingMotion from "./landing-motion";
import { LandingPreviewSection, LandingPreviewSkeleton } from "./landing-preview";
import { ProductScrollytelling, SourceLayerExplorer } from "./landing-product-story";
import { MethodPipeline, TelegramDeliveryDemo } from "./landing-quality-demo";
import RadarCanvas from "./radar-canvas";
import ScrollReveal from "./scroll-reveal";
import ScrollProgress from "./scroll-progress";
import { SiteFooter } from "./ui/site-footer";

export const dynamic = "force-dynamic";

const LANDING_TITLE = "Recruiter Radar — компании, которым стоит написать сегодня";
const LANDING_DESCRIPTION = "Ежедневный evidence-first радар клиентских возможностей для рекрутинговых агентств: сигнал найма, почему сейчас, источники, confidence и безопасный следующий шаг.";

export const metadata: Metadata = {
  metadataBase: new URL("https://recruiter-radar.ru"),
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
  alternates: {
    canonical: "https://recruiter-radar.ru/",
  },
  openGraph: {
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    url: "https://recruiter-radar.ru/",
    siteName: "Recruiter Radar",
    locale: "ru_RU",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Recruiter Radar — компании, которым стоит написать сегодня" }],
  },
  twitter: {
    card: "summary_large_image",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  // Pure search-param parse only — no DB. This keeps `previewInput` available
  // for the pricing cards + closing CTA (which read it synchronously) while the
  // actual digest DB query lives behind a <Suspense> boundary in <PreviewSection>
  // below. The home page is `force-dynamic`, so without the boundary the whole
  // server render blocked on getPublicSampleDigestState (a Postgres query) and
  // first-contentful-paint sat at ~2.5s — the "half the landing doesn't load"
  // symptom. Now hero + problem + how-it-works + quality + pricing + FAQ
  // paint immediately and the live preview streams in.
  const previewInput = readPublicPreviewInput(resolvedSearchParams);
  const hasPreview = hasPublicPreviewInput(previewInput);
  const checkoutHref = buildCheckoutHref(previewInput);
  const paymentSetup = getPaymentProviderSetupState();
  const faqItems = buildFaqItems(paymentSetup.configured);
  const pilotPlan = PUBLIC_PLANS.find((p) => p.code === "pilot") ?? PUBLIC_PLANS[0];
  const secondaryPlans = PUBLIC_PLANS.filter((p) => p.code !== "pilot");

  return (
    <PageFrame maxWidth="1160px">
      <LandingAnalytics />
      <LandingMotion />
      <ScrollProgress />
      <div className={hpStyles.ambientBg} aria-hidden="true">
        <span className={hpStyles.ambientGrid} data-ambient-grid />
      </div>
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>
      <LandingHeader />

      {/* Hero */}
      <section
        id="main-content"
        className={hpStyles.heroSection}
        aria-label="Recruiter Radar"
        data-deploy-anchor="landing-private-intelligence-v2"
      >
        <RadarCanvas />
        <div className={hpStyles.heroContent}>
          <div className={hpStyles.heroCopy}>
            <div className={hpStyles.heroEyebrow}>
              <span aria-hidden="true" />
              Клиентский радар для рекрутинговых агентств
            </div>
            <h1 className={hpStyles.heroTitle}>
              Находите компании с подтверждённым спросом — <span className={hpStyles.heroTitleAccent}>пока окно обращения открыто.</span>
            </h1>
            <p className={hpStyles.heroSubtitle}>
              Радар ежедневно отбирает компании под профиль агентства и показывает: что изменилось, почему писать сейчас, чем это подтверждено и какой следующий шаг сделать.
            </p>
            <div className={hpStyles.heroActions}>
              <Link
                href="#preview-configurator"
                className={hpStyles.heroCta}
                data-landing-events="preview_started"
                data-landing-event-context="hero"
              >
                Собрать мой радар
                <svg className={hpStyles.heroCtaArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="13 6 19 12 13 18" />
                </svg>
              </Link>
              <a
                href="#preview-results"
                className={hpStyles.heroSecondaryCta}
                data-landing-events="preview_started"
                data-landing-event-context="hero"
              >
                Посмотреть живой пример
              </a>
            </div>
            <p className={hpStyles.heroFootnote}>
              {pilotPlan.price} за {pilotPlan.cadence} · без автопродления · Telegram-first
            </p>
          </div>

          <LandingHeroDemo />

        </div>
      </section>

      <aside className={hpStyles.trustStrip} aria-label="Принципы Recruiter Radar">
        <ul>
          <li><strong>Не база вакансий</strong><span>Приоритеты формируются под профиль агентства.</span></li>
          <li><strong>Каждая рекомендация с доказательствами</strong><span>Факты, даты и источники находятся рядом с выводом.</span></li>
          <li><strong>Без автоматической рассылки</strong><span>Решение об обращении к компании остаётся за агентством.</span></li>
        </ul>
      </aside>

      {/* Problem — why this radar exists */}
      <ScrollReveal as="section" className={`${hpStyles.scrollSection} ${hpStyles.problemSection}`} stagger>
        <div className={hpStyles.problemLayout}>
          <div className={hpStyles.problemIntro}>
            <SectionIntro
              accent
              eyebrow="Проблема"
              title="Вакансий много. Приоритета нет."
              description="Радар сокращает исследование до короткого списка компаний, где найм подтверждён, момент объясним, а следующий шаг понятен."
            />
            <p className={hpStyles.problemComparison}>
              Обычный мониторинг показывает, кто нанимает. <strong>Recruiter Radar показывает, кому стоит написать вашему агентству именно сейчас.</strong>
            </p>
          </div>
          <ol className={hpStyles.problemList}>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>01</span>
              <div><h3>Все видят одни вакансии</h3><p>Обычная реакция на публикацию не даёт преимущества: её одновременно замечают десятки агентств.</p></div>
            </li>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>02</span>
              <div><h3>Вакансия ещё не означает спрос</h3><p>Нужны динамика найма, профиль компании и несколько независимых фактов — не один заголовок.</p></div>
            </li>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>03</span>
              <div><h3>Контекст собирается слишком долго</h3><p>Источники, даты и корпоративный контакт приходится проверять вручную, когда момент уже уходит.</p></div>
            </li>
          </ol>
        </div>
      </ScrollReveal>

      {/* Live preview — DB-backed, so it streams in via Suspense. The rest of
          the page (hero/problem/how-it-works/quality/pricing/FAQ) paints
          immediately without waiting for the digest query. See the note at the
          top of HomePage on why this boundary fixes the slow first paint. */}
      <Suspense fallback={<LandingPreviewSkeleton />}>
        <LandingPreviewSection previewInput={previewInput} hasPreview={hasPreview} checkoutHref={checkoutHref} />
      </Suspense>

      {/* How it works — the three-step flow */}
      <ScrollReveal as="section" id="how-it-works" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Как работает"
          title="Готовый список — каждое утро"
          description="Настраиваете профиль один раз. Дальше радар сам собирает и проверяет сигналы найма."
        />
        <ProductScrollytelling />
        <aside className={hpStyles.sourceArchitecture} aria-labelledby="source-architecture-title">
          <div className={hpStyles.sourceArchitectureHeader}>
            <div>
              <span className={hpStyles.sourceArchitectureEyebrow}>Контур данных</span>
              <h3 id="source-architecture-title">Каждый источник отвечает за свою часть доказательства</h3>
            </div>
            <p>Лид появляется не из списка площадок. Сначала радар находит сигнал найма, затем подтверждает компанию и только после добавляет контекст.</p>
          </div>

          <SourceLayerExplorer />

          <details className={hpStyles.sourceGateDisclosure}>
            <summary>
              <span>Что пока не попадает в клиентскую выдачу</span>
              <em>5 групп источников</em>
            </summary>
            <p>SuperJob, Хабр Карьера, страницы компаний LinkedIn, технологические и региональные доски вакансий остаются за контуром выдачи, пока не пройдут проверки уверенности, качества данных и правомерности доступа.</p>
          </details>
        </aside>
      </ScrollReveal>

      {/* Evidence contract + enabled delivery channels */}
      <ScrollReveal as="section" id="quality" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Проверка сигнала"
          title="Почему компании стоит написать"
          description="Рекомендация появляется только вместе с проверяемыми фактами, уровнем уверенности и безопасным корпоративным контактом."
        />
        <div className={hpStyles.qualityGrid}>
          <article className={hpStyles.qualityMethodCard}>
            <div className={hpStyles.qualityCardTopbar}>
              <span>Контур проверки</span>
              <span className={hpStyles.qualityDemoBadge}>Проверка доказательств</span>
            </div>
            <div className={hpStyles.qualityMethodIntro}>
              <h3>Сигнал проходит единый контур проверки</h3>
              <p>Высокий балл сам по себе ничего не доказывает. Радар показывает, из чего сложилась рекомендация.</p>
            </div>
            <MethodPipeline />
            <div className={hpStyles.methodFiurLine} aria-label="Состав приоритета FIUR">
              <span>Соответствие · Fit</span><span>Намерение · Intent</span><span>Актуальность · Urgency</span><span>Доступность · Reachability</span>
            </div>
            <details className={hpStyles.methodDetails}>
              <summary>Как рассчитывается приоритет</summary>
              <div>
                <p><strong>Соответствие</strong> — ниша, роли и география совпадают с профилем агентства.</p>
                <p><strong>Намерение</strong> — найм подтверждён несколькими фактами, а не одной вакансией.</p>
                <p><strong>Актуальность</strong> — изменение свежее, момент для обращения ещё актуален.</p>
                <p><strong>Доступность</strong> — найден законный корпоративный путь контакта.</p>
              </div>
            </details>
            <div className={hpStyles.qualityOutcome}><i aria-hidden="true" /><span><strong>Допущено в радар</strong> — факты и ограничения остаются в карточке.</span></div>
          </article>

          <article className={hpStyles.deliveryCard}>
            <div className={hpStyles.deliveryTopbar}>
              <span className={hpStyles.telegramMark} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><path d="M20 4 3.8 10.3c-1.1.4-1.1 1.1-.2 1.4l4.1 1.3 1.6 4.8c.2.6.1.8.8.8.5 0 .8-.2 1-.4l2-1.9 4.2 3.1c.8.4 1.3.2 1.5-.7L21.5 5c.3-1-.4-1.4-1.5-1Z" fill="currentColor" /></svg>
              </span>
              <div><strong>Каналы доставки</strong><span>по расписанию профиля</span></div>
            </div>
            <div className={hpStyles.deliveryChannels} aria-label="Доступные каналы доставки">
              <span data-primary="true">Telegram · основной</span>
              <span>Email</span>
              <span>Web push</span>
              <span>VK</span>
              <span>Webhook</span>
            </div>
            <TelegramDeliveryDemo />
            <p className={hpStyles.feedbackLoopNote}><strong>Контур обратной связи.</strong> Будущая выдача учитывает ваши отметки «Беру», «Позже» и «Не подходит» — без автоматических решений за вас.</p>
            <p className={hpStyles.deliveryNote}>Радар приходит только в подключённые каналы. Вы решаете, кому писать: продукт не отправляет сообщения компаниям автоматически.</p>
          </article>
        </div>
      </ScrollReveal>

      {/* Pricing — hierarchy: primary week plan, then secondary plans */}
      <ScrollReveal as="section" id="pricing" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Пилот"
          title="Пилот на 7 дней — один понятный способ проверить канал."
          description="Пилот — разовая оплата без продления. Месяц и квартал подключаются по заявке после проверки качества."
        />

        <div className={hpStyles.pricingGrid} data-landing-pricing>
          <SurfaceCard
            key={pilotPlan.code}
            className={`${hpStyles.primaryPlanCard} ${hpStyles.revealCard}`}
            padding="var(--plan-card-padding)"
          >
            <div className={hpStyles.primaryPlanCardHead}>
              <div className={ppStyles.planPriceContainer}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <StatusBadge tone="info" className={ppStyles.planBadge}>
                    Пилот на 7 дней
                  </StatusBadge>
                </div>
                <div className={hpStyles.planPriceRow}>
                  <span className={ppStyles.planPrice}>{pilotPlan.price}</span>
                </div>
                <div className={ppStyles.planPriceCadence}>{pilotPlan.cadence}</div>
              </div>
              <span className={hpStyles.primaryPlanBadge}>Рекомендуем начать</span>
            </div>
            <p className={hpStyles.planDescription}>{pilotPlan.description}</p>
            <div className={hpStyles.planFeatureLine}>
              <b>Разовая оплата</b>
              <span>Без автопродления</span>
            </div>
            <p className={hpStyles.billingNote}>После оплаты вы настраиваете профиль и подключаете Telegram.</p>
            <Link
              href={buildCheckoutHref({ ...previewInput, planCode: pilotPlan.code })}
              className={`${ppStyles.primaryAction} ${hpStyles.planCta}`}
              data-landing-events="pilot_cta_clicked"
              data-landing-event-context="pilot"
            >
              Запустить пилот
            </Link>
          </SurfaceCard>

          <div className={hpStyles.secondaryPlanOptions} aria-label="Варианты продолжения после пилота">
            {secondaryPlans.map((plan) => (
              <span key={plan.code}><strong>{plan.name}</strong><b>{plan.price}</b></span>
            ))}
            <small>Подключаются отдельно после пилота · без автоматического списания</small>
          </div>
        </div>

        <div className={hpStyles.includedOnce}>
          <div className={hpStyles.includedOnceLabel}>В любой тариф входит</div>
          <ul className={hpStyles.includedOnceList}>
            {PUBLIC_PLANS[0].bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className={ppStyles.helperText} style={{ marginTop: "4px" }}>
            Оплата через ЮKassa, чек по ФЗ-54.{" "}
            <Link href="/terms" style={{ color: "var(--c-brand)", textDecoration: "underline" }}>Оферта</Link>.
          </div>
        </div>
      </ScrollReveal>

      {/* FAQ */}
      <ScrollReveal as="section" id="faq" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="FAQ"
          title="Главные вопросы перед запуском"
          description="Что именно приходит, откуда берутся данные и что остаётся под вашим контролем."
        />
        {faqItems.map((item, index) => (
          <details
            key={item.question}
            className={`${hpStyles.faqCard} ${hpStyles.revealCard}`}
            data-landing-faq={`faq-${index + 1}`}
          >
            <summary className={hpStyles.faqSummary}>
              <span>{item.question}</span>
              <svg className={hpStyles.faqChevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <div className={hpStyles.faqAnswer}>{item.answer}</div>
          </details>
        ))}
      </ScrollReveal>

      {/* Closing CTA band */}
      <section className={hpStyles.closingBand}>
        <h2 className={hpStyles.closingTitle}>Проверьте новый канал за 7 дней</h2>
        <p className={hpStyles.closingText}>
          Настройте профиль, получите первый радар и решите на фактах, стоит ли продолжать.
        </p>
        <div className={hpStyles.closingActions}>
          <Link
            href={checkoutHref}
            className={hpStyles.heroCta}
            data-landing-events="closing_cta_clicked"
            data-landing-event-context="closing"
          >
            Активировать неделю — 2 990 ₽
          </Link>
          <a
            href="#preview-results"
            className={hpStyles.heroSecondaryCta}
            data-landing-events="preview_started"
            data-landing-event-context="closing"
          >
            Посмотреть пример
          </a>
        </div>
      </section>

      <SiteFooter />
    </PageFrame>
  );
}
