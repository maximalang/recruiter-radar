import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Согласие на обработку персональных данных — Recruiter Radar",
  description: "Отдельное согласие на обработку персональных данных при оформлении Recruiter Radar.",
  robots: { index: true, follow: true },
};

export default function PersonalDataConsentPage() {
  return (
    <PageFrame maxWidth="760px">
      <section className={s.docSection}>
        <SectionIntro
          eyebrow="Отдельный документ"
          title="Согласие на обработку персональных данных"
          description="Этот документ подтверждается отдельным действием и не является частью публичной оферты."
        />

        <p className={s.docOperator}>
          Оператор: <strong>{OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}; e-mail {OPERATOR_REQUISITES.email}; телефон {OPERATOR_REQUISITES.phone}
          {OPERATOR_REQUISITES.postalAddress ? `; адрес для корреспонденции: ${OPERATOR_REQUISITES.postalAddress}` : ""}. Редакция от {LEGAL_DOCUMENTS.personalDataConsent.displayDate}.
        </p>

        <div className={s.docBody}>
          <ConsentSection n="1" title="Волеизъявление">
            <p>Отмечая отдельный checkbox на странице оформления и отправляя форму, я свободно, своей волей и в своём интересе даю конкретное, предметное, информированное, сознательное и однозначное согласие Оператору на обработку указанных ниже персональных данных.</p>
          </ConsentSection>

          <ConsentSection n="2" title="Цели обработки">
            <ul className={s.docList}>
              <li>создание и защита аккаунта;</li>
              <li>оформление, заключение и исполнение договора на доступ к Recruiter Radar;</li>
              <li>проведение и сверка оплаты, возвратов и финансовых статусов;</li>
              <li>формирование и направление чека плательщика НПД;</li>
              <li>настройка профиля поиска и доставка результатов;</li>
              <li>поддержка, претензионная работа и защита прав сторон;</li>
              <li>обеспечение безопасности, предотвращение злоупотреблений и ведение технических журналов.</li>
            </ul>
          </ConsentSection>

          <ConsentSection n="3" title="Перечень данных">
            <p>Согласие распространяется на e-mail, имя или название агентства/команды, телефон или Telegram-контакт при их предоставлении, параметры профиля поиска, содержание обращений, идентификаторы аккаунта и подключённых каналов, сумму/валюту/дату/статус и идентификаторы заказа, платежа и возврата, сведения для направления чека НПД, IP-адрес, данные браузера/устройства, сведения о сессии и события безопасности.</p>
            <p>Реквизиты банковской карты Оператор не получает и не хранит: они вводятся и обрабатываются на стороне ЮKassa.</p>
          </ConsentSection>

          <ConsentSection n="4" title="Действия и способы обработки">
            <p>Оператор вправе выполнять сбор, запись, систематизацию, накопление, хранение, уточнение, извлечение, использование, передачу уполномоченным обработчикам, обезличивание, блокирование, удаление и уничтожение данных автоматизированным способом, а при обработке обращений и документов — также без использования средств автоматизации.</p>
          </ConsentSection>

          <ConsentSection n="5" title="Получатели и обработчики">
            <p>В необходимом объёме данные могут обрабатываться ЮKassa, ФНС России/«Мой налог» или разрешённым оператором НПД, почтовым сервисом, поставщиками российской инфраструктуры, резервного копирования и безопасности, а также Telegram — только при самостоятельном подключении этого канала пользователем.</p>
            <p>Необязательная Яндекс Метрика регулируется отдельным opt-in и настоящим согласием автоматически не включается.</p>
          </ConsentSection>

          <ConsentSection n="6" title="Срок действия">
            <p>Согласие действует с момента его подтверждения до достижения целей обработки или до отзыва, если обработка не должна продолжаться на другом законном основании. Данные договора, платежей и налоговых документов могут храниться в течение обязательных сроков, установленных законодательством.</p>
          </ConsentSection>

          <ConsentSection n="7" title="Отзыв согласия">
            <p>Согласие можно отозвать обращением на <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>. В обращении нужно указать e-mail аккаунта и требование об отзыве. Отзыв не влияет на законность обработки до его получения и не прекращает обработку, необходимую для исполнения договора, соблюдения закона или защиты законных требований.</p>
          </ConsentSection>

          <ConsentSection n="8" title="Дополнительная информация">
            <p>Подробные правила, сроки, права пользователя, меры защиты, локализация и порядок рассмотрения обращений приведены в <Link href="/privacy" className={s.docLink}>Политике обработки персональных данных</Link>. Полные реквизиты Оператора опубликованы на странице <Link href="/legal" className={s.docLink}>«Реквизиты»</Link>.</p>
          </ConsentSection>
        </div>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}

function ConsentSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.docClause}>
      <h2 className={s.docClauseTitle}>{n}. {title}</h2>
      <div className={s.docClauseText}>{children}</div>
    </section>
  );
}
