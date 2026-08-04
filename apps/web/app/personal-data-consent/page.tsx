import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

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
          description="Согласие подтверждается отдельным действием на странице оформления, фиксируется вместе с редакцией документа и не подменяется акцептом оферты."
        />

        <p className={s.docOperator}>
          Оператор: <strong>{OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}; e-mail {OPERATOR_REQUISITES.email}; телефон {OPERATOR_REQUISITES.phone}. Редакция от {LEGAL_DOCUMENTS.personalDataConsent.displayDate}.
        </p>

        <div className={s.docBody}>
          <ConsentSection n="1" title="Способ предоставления согласия">
            <p>Отмечая отдельный checkbox «Я даю согласие на обработку персональных данных» и отправляя форму оформления, я свободно, своей волей и в своём интересе даю конкретное, предметное, информированное, сознательное и однозначное согласие.</p>
            <p>Доказательством согласия служит запись о времени, идентификаторе аккаунта и заказе, редакции документа и результате серверной проверки checkbox. Отсутствие отметки не позволяет отправить форму.</p>
          </ConsentSection>

          <ConsentSection n="2" title="Цели">
            <ul className={s.docList}>
              <li>создание заказа и связь с подтверждённым аккаунтом;</li>
              <li>заполнение и сохранение профиля Recruiter Radar;</li>
              <li>передача минимально необходимых сведений Robokassa для проведения и подтверждения оплаты;</li>
              <li>передача e-mail и сведений об операции для формирования и доставки чека НПД;</li>
              <li>направление транзакционных сообщений об аккаунте, заказе, доступе и возврате;</li>
              <li>рассмотрение обращения, претензии или запроса субъекта.</li>
            </ul>
          </ConsentSection>

          <ConsentSection n="3" title="Перечень данных">
            <p>Согласие распространяется на e-mail, имя или название агентства/команды, параметры профиля поиска, предоставленный пользователем контакт, идентификаторы аккаунта и заказа, выбранный тариф, сумму и валюту, дату и статус платежа или возврата, сведения о принятии документов, данные для чека НПД, содержание обращения, IP-адрес, user-agent и события безопасности, связанные с оформлением.</p>
            <p>Recruiter Radar не получает и не хранит полный номер карты, срок её действия и CVC/CVV. Эти сведения вводятся на стороне Robokassa.</p>
          </ConsentSection>

          <ConsentSection n="4" title="Операции и способы обработки">
            <p>Могут выполняться сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача определённым обработчикам, обезличивание, блокирование, удаление и уничтожение автоматизированным способом и, при разборе обращений, без использования автоматизации.</p>
          </ConsentSection>

          <ConsentSection n="5" title="Получатели">
            <ul className={s.docList}>
              <li>ООО «РОБОКАССА» — платёжная форма, подтверждение операции и возврат;</li>
              <li>ФНС России, «Мой налог» и «Робочеки СМЗ» — регистрация дохода и чек НПД;</li>
              <li>поставщик транзакционной почты — отправка кодов входа, статусов заказа и чека;</li>
              <li>российские поставщики хостинга, базы данных, резервного копирования и безопасности — работа сервиса.</li>
            </ul>
            <p>Данные передаются только в объёме, необходимом для соответствующей функции.</p>
          </ConsentSection>

          <ConsentSection n="6" title="Что не входит в это согласие">
            <p>Необязательная аналитика Яндекс Метрики включается только отдельным выбором в интерфейсе cookies.</p>
            <p>Telegram подключается пользователем отдельно после оплаты. Возможная передача данных этому сервису не считается автоматически разрешённой checkbox оформления и описывается непосредственно при подключении канала.</p>
          </ConsentSection>

          <ConsentSection n="7" title="Срок действия и хранение">
            <p>Согласие действует до достижения указанных целей или до отзыва. Конкретные сроки по категориям данных приведены в <Link href="/privacy" className={s.docLink}>политике обработки персональных данных</Link>.</p>
            <p>Отзыв согласия не прекращает обработку, которая после отзыва необходима для исполнения договора, возврата, налогового учёта, безопасности или защиты прав на другом законном основании.</p>
          </ConsentSection>

          <ConsentSection n="8" title="Отзыв и права">
            <p>Отзыв и иные требования направляются на <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>. В письме следует указать e-mail аккаунта, суть требования и достаточные сведения для поиска записи без отправки лишних документов.</p>
            <p>Права, сроки ответа, порядок уточнения, блокирования и уничтожения данных приведены в <Link href="/privacy" className={s.docLink}>политике</Link>.</p>
          </ConsentSection>

          <ConsentSection n="9" title="Связанные документы">
            <p>Договорные условия содержатся в <Link href="/terms" className={s.docLink}>публичной оферте</Link>, порядок оплаты и возврата — на странице <Link href="/payment-and-refund" className={s.docLink}>«Оплата и возврат»</Link>, полные реквизиты — на странице <Link href="/legal" className={s.docLink}>«Реквизиты»</Link>.</p>
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
