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
          description="Согласие подтверждается отдельным действием на странице оформления и не подменяется акцептом публичной оферты."
        />

        <p className={s.docOperator}>
          Оператор: <strong>{OPERATOR_REQUISITES.fullName}</strong>, ИНН {OPERATOR_REQUISITES.inn}; e-mail {OPERATOR_REQUISITES.email}; телефон {OPERATOR_REQUISITES.phone}. Редакция от {LEGAL_DOCUMENTS.personalDataConsent.displayDate}.
        </p>

        <div className={s.docBody}>
          <ConsentSection n="1" title="Волеизъявление">
            <p>Отмечая отдельный checkbox на странице оформления и отправляя форму, я свободно, своей волей и в своём интересе даю конкретное, предметное, информированное, сознательное и однозначное согласие на обработку указанных ниже персональных данных.</p>
          </ConsentSection>

          <ConsentSection n="2" title="Цели обработки">
            <ul className={s.docList}>
              <li>создание и защита аккаунта;</li>
              <li>оформление и исполнение договора на доступ к Recruiter Radar;</li>
              <li>проведение и сверка оплаты и возвратов;</li>
              <li>формирование и направление чека плательщика НПД;</li>
              <li>настройка профиля поиска и доставка результатов;</li>
              <li>поддержка, претензионная работа и предотвращение злоупотреблений.</li>
            </ul>
          </ConsentSection>

          <ConsentSection n="3" title="Перечень данных">
            <p>Согласие распространяется на e-mail, имя или название агентства/команды, добровольно предоставленные контактные данные, параметры профиля поиска, содержание обращений, идентификаторы аккаунта и каналов, сумму, валюту, дату, статус и идентификаторы заказа, платежа и возврата, сведения для чека НПД, IP-адрес, данные браузера, сведения о сессии и события безопасности.</p>
            <p>Полный номер карты, срок её действия и CVC/CVV Recruiter Radar не получает и не хранит: эти данные обрабатываются на стороне Robokassa.</p>
          </ConsentSection>

          <ConsentSection n="4" title="Действия с данными">
            <p>Могут выполняться сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача уполномоченным обработчикам, обезличивание, блокирование, удаление и уничтожение данных автоматизированным и, при работе с обращениями, неавтоматизированным способом.</p>
          </ConsentSection>

          <ConsentSection n="5" title="Получатели и обработчики">
            <p>В необходимом объёме данные могут обрабатываться Robokassa, ФНС России/«Мой налог» или разрешённым оператором НПД, почтовым сервисом, российскими поставщиками инфраструктуры и безопасности, а также Telegram — только после самостоятельного подключения пользователем.</p>
          </ConsentSection>

          <ConsentSection n="6" title="Срок и отзыв">
            <p>Согласие действует до достижения целей обработки или до отзыва, если обработка не должна продолжаться на другом законном основании. Отзыв направляется на <a href={`mailto:${OPERATOR_REQUISITES.email}`} className={s.docLink}>{OPERATOR_REQUISITES.email}</a>.</p>
            <p>Отзыв не влияет на законность предыдущей обработки и не прекращает хранение договорных, платёжных и налоговых сведений в обязательные сроки.</p>
          </ConsentSection>

          <ConsentSection n="7" title="Дополнительная информация">
            <p>Подробные правила, права пользователя, меры защиты и сроки хранения приведены в <Link href="/privacy" className={s.docLink}>Политике обработки персональных данных</Link>. Полные реквизиты размещены на странице <Link href="/legal" className={s.docLink}>«Реквизиты»</Link>.</p>
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
