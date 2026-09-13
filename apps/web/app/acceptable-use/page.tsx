import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { LegalDocumentNav } from "../ui/legal-document-nav";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Правила использования сервиса — Recruiter Radar",
  description:
    "Разрешённое профессиональное использование Recruiter Radar и запрещённые практики: спам, массовая рассылка, извлечение базы, обход ограничений.",
  robots: { index: true, follow: true },
};

export default function AcceptableUsePage() {
  return (
    <PageFrame maxWidth="820px">
      <section className={s.docSection}>
        <LegalDocumentNav current="/acceptable-use" />
        <SectionIntro
          eyebrow="Правила"
          title="Правила использования сервиса"
          description="Recruiter Radar поставляет разведку и доказательства, а решение о контакте и само сообщение всегда остаются за клиентом."
        />

        <p className={s.docOperator}>
          Оператор: <strong>{OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}, {OPERATOR_REQUISITES.city}. Редакция от {LEGAL_DOCUMENTS.acceptableUse.displayDate}. Договорная основа — <Link href="/terms" className={s.docLink}>публичная оферта</Link>.
        </p>

        <div className={s.docSummary}>
          <Summary label="Модель" value="Разведка, не рассылка" />
          <Summary label="Авто-рассылка" value="Отсутствует" />
          <Summary label="Нарушение" value="Ограничение доступа" />
        </div>

        <p className={s.docCallout}>
          <strong>Главное:</strong> сообщения компаниям Recruiter Radar не отправляет — ни автоматически, ни вручную. Сервис подсказывает безопасный корпоративный путь контакта, но пишет и отправляет только сам пользователь.
        </p>

        <div className={s.docBody}>
          <PolicySection n="1" title="Разрешённое использование">
            <p>Сервис предназначен для законных профессиональных задач рекрутинга и кадрового поиска: приоритизация компаний с актуальными сигналами найма, подготовка обоснованного первого делового контакта от имени вашей организации, внутренняя аналитика рынка найма. Результаты предназначены для внутреннего использования вашей командой в течение оплаченного периода.</p>
          </PolicySection>

          <PolicySection n="2" title="Запрещённые практики">
            <ul className={s.docList}>
              <li>массовые нежелательные рассылки и спам по компаниям или представителям;</li>
              <li>автоматизированная массовая отправка сообщений — сервис не предоставляет такой функции, а её реализация поверх сервиса запрещена;</li>
              <li>сбор личных телефонов и личных e-mail, извлечение персональных данных без законного основания;</li>
              <li>передача доступа третьим лицам, перепродажа доступа или результатов;</li>
              <li>массовое извлечение, выгрузка или «скрейпинг» базы сервиса целиком или существенными частями;</li>
              <li>обход технических ограничений, лимитов частоты запросов и средств контроля доступа;</li>
              <li>попытки деанонимизации пользователей, обогащения выдачи посторонними персональными данными или связывания её с иными базами лиц;</li>
              <li>дискриминационный или незаконный таргетинг (по национальности, религии, здоровью и иным защищённым признакам);</li>
              <li>использование, нарушающее права источников информации или применимое законодательство;</li>
              <li>представление сервиса как гарантирующего коммерческий результат, отклик или сделки.</li>
            </ul>
          </PolicySection>

          <PolicySection n="3" title="Граница ответственности за коммуникации">
            <p>Recruiter Radar поставляет разведку и доказательства: кто компания, что изменилось, почему сейчас, где безопасный корпоративный контакт. Решение о контакте, содержание сообщения и момент отправки — исключительная ответственность клиента. Соблюдайте требования законодательства о связи, рекламы и персональных данных при исходящих коммуникациях.</p>
          </PolicySection>

          <PolicySection n="4" title="Последствия нарушения">
            <p>При подтверждённом нарушении доступ может быть временно ограничен или прекращён в порядке, предусмотренном офертой (разделы 8 и 12). Очевидные нарушения закона могут быть переданы компетентным органам. Если вы считаете ограничение ошибочным — напишите на <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>.</p>
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
