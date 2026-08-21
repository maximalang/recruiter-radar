import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { LegalDocumentNav } from "../ui/legal-document-nav";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Cookies и аналитика — Recruiter Radar",
  description:
    "Какие cookies и аналитику использует Recruiter Radar: обязательные элементы, необязательная Яндекс Метрика, сроки действия и управление согласием.",
  robots: { index: true, follow: true },
};

export default function CookiesPage() {
  return (
    <PageFrame maxWidth="820px">
      <section className={s.docSection}>
        <LegalDocumentNav current="/cookies" />
        <SectionIntro
          eyebrow="Cookies"
          title="Cookies и аналитика"
          description="Обязательные cookies работают всегда. Необязательная веб-аналитика включается только отдельным согласием и отключается в любой момент."
        />

        <p className={s.docOperator}>
          Оператор сайта: <strong>{OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}, {OPERATOR_REQUISITES.city}. Вопросы: {" "}
          <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>. Редакция от {LEGAL_DOCUMENTS.cookies.displayDate}.
        </p>

        <div className={s.docSummary}>
          <Summary label="Обязательные" value="Сессия · Безопасность" />
          <Summary label="Аналитика" value="Только по согласию" />
          <Summary label="Срок согласия" value="До 14 месяцев" />
        </div>

        <p className={s.docCallout}>
          <strong>Коротко:</strong> без вашего выбора «Разрешить» Яндекс Метрика не загружается вовсе — ни скрипт, ни cookie. Отказ так же прост, как согласие, и не ограничивает работу сайта.
        </p>

        <div className={s.docBody}>
          <PolicySection n="1" title="Обязательные cookies">
            <div className={s.docTableWrap}>
              <table className={s.docTable}>
                <thead><tr><th scope="col">Cookie</th><th scope="col">Назначение</th><th scope="col">Срок</th></tr></thead>
                <tbody>
                  <tr><td><code>__Host-rr_session</code></td><td>подписанная сессия после входа; без неё защищённые страницы не работают</td><td>срок сессии</td></tr>
                  <tr><td><code>__Host-rr_email_change</code>, <code>__Host-rr_workspace_invite</code> и одноразовые ссылки входа</td><td>защищённые pending-действия: подтверждение e-mail, приглашение, вход по ссылке</td><td>минимальный технический срок действия</td></tr>
                </tbody>
              </table>
            </div>
            <p>Это строго необходимые элементы для запрошенной пользователем функции: они не используются для рекламы или профилирования и работают независимо от выбора аналитики. Выбор согласия хранится локально (localStorage), а не в cookie.</p>
          </PolicySection>

          <PolicySection n="2" title="Необязательная аналитика: Яндекс Метрика">
            <p><strong>Назначение:</strong> обезличенная оценка посещаемости публичных страниц (какие разделы читают, откуда приходят посетители). Метрика не размещается на checkout, в аккаунте, onboarding и операционных разделах.</p>
            <p><strong>Что загружается:</strong> скрипт <code>mc.yandex.ru/metrika/tag.js</code> и его запросы — только после положительного выбора. Настройки счётчика: без клик-карты, без вебвизора, без передачи заголовков страниц.</p>
            <div className={s.docTableWrap}>
              <table className={s.docTable}>
                <thead><tr><th scope="col">Cookie / элемент</th><th scope="col">Назначение</th><th scope="col">Срок действия</th></tr></thead>
                <tbody>
                  <tr><td><code>_ym_uid</code></td><td>различение посетителей</td><td>1 год</td></tr>
                  <tr><td><code>_ym_d</code></td><td>дата первого визита</td><td>с датой визита</td></tr>
                  <tr><td><code>_ym_isad</code></td><td>определение блокировщиков рекламы</td><td>20 часов</td></tr>
                  <tr><td><code>_ym_metrika_enabled</code></td><td>служебная проверка установки остальных cookie</td><td>60 минут</td></tr>
                </tbody>
              </table>
            </div>
            <p>Сроки соответствуют официальной документации Яндекса. Получатель данных — ООО «Яндекс» (Россия); обработка происходит на стороне Яндекса как самостоятельного оператора аналитики.</p>
          </PolicySection>

          <PolicySection n="3" title="Как работает выбор">
            <ul className={s.docList}>
              <li>при первом посещении показывается отдельный запрос: «Разрешить», «Отклонить необязательные» или «Настроить»;</li>
              <li>молчаливое продолжение использования сайта, прокрутка или закрытие диалога не считаются согласием;</li>
              <li>выбор сохраняется локально и действует до отзыва, но не более 14 месяцев — затем запрашивается заново;</li>
              <li>изменение модели согласия инвалидирует прежний выбор: при существенных изменениях запрашивается повторное решение;</li>
              <li>отказ ничем не ухудшает доступ к функциям сервиса.</li>
            </ul>
          </PolicySection>

          <PolicySection n="4" title="Отзыв и изменение выбора">
            <p>В любой момент: ссылка «Настройки cookies» в подвале сайта открывает тот же диалог — можно отозвать согласие или разрешить аналитику. При отзыве аналитический скрипт останавливается, а cookie Метрики (<code>_ym_uid</code>, <code>_ym_d</code>, <code>_ym_isad</code>) удаляются из браузера. Дополнительно выбор сбрасывается очисткой данных сайта для этого домена.</p>
          </PolicySection>

          <PolicySection n="5" title="Связанные документы">
            <p>Цели и правовые основания обработки, включая аналитику, — в <Link href="/privacy" className={s.docLink}>политике обработки персональных данных</Link>. Условия использования — в <Link href="/terms" className={s.docLink}>публичной оферте</Link>.</p>
          </PolicySection>
        </div>
      </section>
      <SiteFooter showCookieSettings />
    </PageFrame>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className={s.docSummaryItem}><span className={s.docSummaryLabel}>{label}</span><span className={s.docSummaryValue}>{value}</span></div>;
}

function PolicySection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.docClause}>
      <h2 className={s.docClauseTitle}>{n}. {title}</h2>
      <div className={s.docClauseText}>{children}</div>
    </section>
  );
}
