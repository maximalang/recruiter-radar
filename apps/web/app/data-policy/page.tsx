import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { LegalDocumentNav } from "../ui/legal-document-nav";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Публичные источники и исправление данных — Recruiter Radar",
  description:
    "Как Recruiter Radar работает с публичными данными компаний и представителей, что исключается из выдачи и как запросить исправление или удаление.",
  robots: { index: true, follow: true },
};

export default function DataPolicyPage() {
  const email = OPERATOR_REQUISITES.email;

  return (
    <PageFrame maxWidth="820px">
      <section className={s.docSection}>
        <LegalDocumentNav current="/data-policy" />
        <SectionIntro
          eyebrow="Данные и источники"
          title="Публичные источники, исправление и удаление"
          description="Основной объект сервиса — организация. Личные данные обрабатываются минимально, а субъект вправе потребовать исправления, подавления или удаления сведений о себе."
        />

        <p className={s.docOperator}>
          Оператор: <strong>{OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}, {OPERATOR_REQUISITES.city}. Запросы: {" "}
          <a href={`mailto:${email}`} className={s.docLink}>{email}</a>. Редакция от {LEGAL_DOCUMENTS.dataPolicy.displayDate}.
        </p>

        <div className={s.docSummary}>
          <Summary label="Объект" value="Компания, а не человек" />
          <Summary label="Ответ на запрос" value="10 рабочих дней" />
          <Summary label="Паспорт" value="По умолчанию не требуется" />
        </div>

        <p className={s.docCallout}>
          <strong>Главное:</strong> мы не создаём базу личных контактов. Если опубликованное доказательство содержит сведения о представителе компании, остаётся только минимальный профессиональный контекст со ссылкой на источник.
        </p>

        <div className={s.docBody}>
          <PolicySection n="1" title="Какие данные о компаниях обрабатываются">
            <p>Название и организационно-правовая форма, ИНН/ОГРН, домен и карьерная страница, вакансии и сигналы найма, публичные корпоративные события — вместе со ссылкой на первоисточник и временем публикации (свежестью). Это сведения об организациях из правомерно доступных публичных источников: карьерные страницы, hh.ru, «Работа России», реестры ФНС, Федресурс и другие открытые источники.</p>
          </PolicySection>

          <PolicySection n="2" title="Представители компаний: что допускается">
            <p>Если само опубликованное доказательство содержит сведения о представителе, обрабатывается только профессиональный контекст: имя, должность или роль, организация, корпоративный путь контакта (например, общий HR-адрес или телефон коммутатора) и ссылка на источник.</p>
            <p>В обычную клиентскую выдачу <strong>не включаются</strong>: личные мобильные телефоны и личные e-mail; специальные категории данных; биография и сведения, не связанные с профессиональной ролью; личные профили в соцсетях, если они не являются профессиональным доказательством по сигналу.</p>
          </PolicySection>

          <PolicySection n="3" title="Источники, атрибуция и свежесть">
            <p>Каждый элемент доказательства сопровождается источником и датой. Данные не переиздаются как собственная «база»: клиент видит выдержки и ссылки. Мы уважаем правила источников: доступ осуществляется к открытым материалам без обхода технических ограничений, а правообладатель может ограничивать повторное использование своих материалов — поэтому свободное копирование всей выдачи правилами сервиса запрещено.</p>
          </PolicySection>

          <PolicySection n="4" title="Исправление, удаление, подавление">
            <p>Запрос направляется на <a href={`mailto:${email}`} className={s.docLink}>{email}</a>. Укажите: какие сведения относятся к вам (или к вашей организации), ссылку или описание карточки, суть требования — уточнить, удалить, подавить в выдаче или возразить против обработки. Паспорт или иные документы по умолчанию не требуются: достаточно сведений, позволяющих найти запись.</p>
            <ul className={s.docList}>
              <li><strong>уточнение</strong> — неточные или устаревшие сведения исправляются;</li>
              <li><strong>удаление</strong> — относящиеся к вам сведения удаляются из активных систем;</li>
              <li><strong>подавление</strong> — запись исключается из будущих подборок даже при сохранении исходной публичной публикации;</li>
              <li><strong>ошибочная связь</strong> — связь «человек ↔ организация» проверяется и разрывается;</li>
              <li><strong>исправление в источнике</strong> — если ошибка в первоисточнике, укажем источник, чтобы вы обратились к его владельцу; после исправления обновим и у себя.</li>
            </ul>
            <p>Ответ — в течение 10 рабочих дней; продление не более чем на 5 рабочих дней с мотивированным уведомлением. Правомерное удержание (например, налоговые записи по вашему же заказу) действует независимо и объясняется в ответе. Порядок для пользователей аккаунта — см. <Link href="/privacy" className={s.docLink}>политику обработки персональных данных</Link>.</p>
          </PolicySection>

          <PolicySection n="5" title="Жалобы">
            <p>Если считаете обработку неправомерной, можно обратиться в Роскомнадзор или суд. Мы просим сначала сообщить нам — большинство вопросов решается быстрее.</p>
          </PolicySection>
        </div>
      </section>
      <SiteFooter />
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
