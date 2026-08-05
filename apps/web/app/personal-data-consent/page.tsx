import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";
import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { PageFrame, SectionIntro } from "../ui/page-primitives";
import { LegalDocumentNav } from "../ui/legal-document-nav";
import { SiteFooter } from "../ui/site-footer";
import s from "../ui/legal-document.module.css";

export const metadata: Metadata = {
  title: "Согласие на обработку персональных данных — Recruiter Radar",
  description: "Отдельное согласие на обработку персональных данных при оформлении Recruiter Radar.",
  robots: { index: true, follow: true },
};

export default function PersonalDataConsentPage() {
  return (
    <PageFrame maxWidth="800px">
      <section className={s.docSection}>
        <LegalDocumentNav current="/personal-data-consent" />
        <SectionIntro
          eyebrow="Отдельный документ"
          title="Согласие на обработку персональных данных"
          description="Конкретное согласие для оформления заказа и предоставления сервиса. Оно подтверждается отдельно от оферты и сохраняется с номером редакции."
        />

        <p className={s.docOperator}>
          Оператор: <strong>{OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}, {OPERATOR_REQUISITES.city}; e-mail {OPERATOR_REQUISITES.email}; телефон {OPERATOR_REQUISITES.phone}. Редакция от {LEGAL_DOCUMENTS.personalDataConsent.displayDate}.
        </p>

        <div className={s.docSummary}>
          <Summary label="Действие" value="Отдельная пустая галочка" />
          <Summary label="Фиксация" value="Дата, аккаунт, заказ, редакция" />
          <Summary label="Отзыв" value={OPERATOR_REQUISITES.email} />
        </div>

        <p className={s.docCallout}>
          <strong>Последствие отказа:</strong> без данных, необходимых для аккаунта, заказа, оплаты и чека, оператор не сможет заключить и исполнить договор. Необязательная аналитика и Telegram в это согласие не включены.
        </p>

        <div className={s.docBody}>
          <ConsentSection n="1" title="Способ предоставления согласия">
            <p>Отмечая отдельный checkbox «Я даю согласие на обработку персональных данных» и отправляя форму оформления, я свободно, своей волей и в своём интересе даю конкретное, предметное, информированное, сознательное и однозначное согласие.</p>
            <p>Checkbox изначально не отмечен. Доказательством согласия служит запись о времени, идентификаторе аккаунта и заказа, редакциях согласия и политики, а также результате серверной проверки.</p>
          </ConsentSection>

          <ConsentSection n="2" title="Цели обработки">
            <ul className={s.docList}>
              <li>создание и защита аккаунта;</li>
              <li>оформление заказа и исполнение договора Recruiter Radar;</li>
              <li>настройка профиля радара и предоставление результатов;</li>
              <li>проведение и подтверждение оплаты через Robokassa;</li>
              <li>формирование, доставка и корректировка чека НПД;</li>
              <li>направление обязательных транзакционных сообщений;</li>
              <li>поддержка, возврат, претензионная работа и предотвращение злоупотреблений.</li>
            </ul>
          </ConsentSection>

          <ConsentSection n="3" title="Перечень данных">
            <p>Согласие распространяется на e-mail, имя или название агентства/команды, параметры профиля поиска, идентификаторы аккаунта и заказа, тариф, сумму и валюту, дату и статус платежа или возврата, сведения о принятии документов, данные для чека НПД, содержание обращения, IP-адрес, user-agent и относящиеся к оформлению события безопасности.</p>
            <p>Если покупателем является ООО или ИП, дополнительно обрабатывается ИНН покупателя, необходимый для корректного чека НПД. Recruiter Radar не получает и не хранит полный номер карты, срок её действия и CVC/CVV.</p>
          </ConsentSection>

          <ConsentSection n="4" title="Операции и способы обработки">
            <p>Могут выполняться сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача определённым получателям, обезличивание, блокирование, удаление и уничтожение автоматизированным способом и, при разборе обращений, без использования автоматизации.</p>
            <p>Распространение данных неопределённому кругу лиц не разрешается настоящим согласием.</p>
          </ConsentSection>

          <ConsentSection n="5" title="Получатели и обработчики">
            <ul className={s.docList}>
              <li><strong>ООО «РОБОКАССА»:</strong> платёжная форма, подтверждение операции и возврат;</li>
              <li><strong>ФНС России, «Мой налог» и «Робочеки СМЗ»:</strong> регистрация дохода, формирование и корректировка чека;</li>
              <li><strong>поставщик транзакционной почты:</strong> коды входа, статусы заказа, чек и ответы поддержки;</li>
              <li><strong>российские поставщики инфраструктуры:</strong> хостинг, база данных, резервное копирование, безопасность и мониторинг.</li>
            </ul>
            <p>Каждому получателю передаётся только объём, необходимый для соответствующей функции.</p>
          </ConsentSection>

          <ConsentSection n="6" title="Что не входит в это согласие">
            <p>Яндекс Метрика включается только отдельным выбором в интерфейсе cookies. Отказ от аналитики не препятствует регистрации, покупке и работе веб-интерфейса.</p>
            <p>Telegram и иные внешние каналы подключаются пользователем отдельно после оплаты. Возможная трансграничная передача не считается разрешённой checkbox оформления.</p>
            <p>Рекламные рассылки и передача данных для рекламы не входят в это согласие.</p>
          </ConsentSection>

          <ConsentSection n="7" title="Срок действия и хранение">
            <p>Согласие действует до достижения целей или отзыва. Конкретные сроки по каждой цели и категории данных приведены в <Link href="/privacy" className={s.docLink}>политике обработки персональных данных</Link>.</p>
            <p>После отзыва оператор вправе продолжить обработку на ином законном основании в объёме, необходимом для исполнения уже заключённого договора, возврата, налогового учёта, безопасности или защиты прав.</p>
          </ConsentSection>

          <ConsentSection n="8" title="Отзыв и реализация прав">
            <p>Отзыв и иные требования направляются на <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>. В письме следует указать e-mail аккаунта, суть требования и сведения, достаточные для поиска записи.</p>
            <p>Оператор может запросить соразмерное подтверждение связи заявителя с аккаунтом, но не просит отправлять лишние документы или платёжные реквизиты.</p>
          </ConsentSection>

          <ConsentSection n="9" title="Связанные документы">
            <p>Подробные цели, основания, сроки и меры защиты приведены в <Link href="/privacy" className={s.docLink}>политике</Link>. Договорные условия содержатся в <Link href="/terms" className={s.docLink}>оферте</Link>, порядок оплаты и возврата — на странице <Link href="/payment-and-refund" className={s.docLink}>«Оплата и возврат»</Link>.</p>
          </ConsentSection>
        </div>
      </section>
      <SiteFooter />
    </PageFrame>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className={s.docSummaryItem}><span className={s.docSummaryLabel}>{label}</span><span className={s.docSummaryValue}>{value}</span></div>;
}

function ConsentSection({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className={s.docClause}>
      <h2 className={s.docClauseTitle}>{n}. {title}</h2>
      <div className={s.docClauseText}>{children}</div>
    </section>
  );
}
