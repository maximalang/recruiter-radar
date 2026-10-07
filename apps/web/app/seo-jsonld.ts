import type { Metadata } from "next";

import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";
import { buildLandingFaqItems } from "./landing/landing-faq";

/**
 * JSON-LD для лендинга: Organization + WebSite + FAQPage.
 * Только подтверждённые факты: реквизиты из operatorRequisites,
 * ответы FAQ — те же строки, что рендерит страница (без дублей текста).
 */
export function buildLandingJsonLd(paymentConfigured: boolean): string {
  const faqItems = buildLandingFaqItems(paymentConfigured);

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${OPERATOR_REQUISITES.website}/#organization`,
        name: OPERATOR_REQUISITES.brandName,
        url: OPERATOR_REQUISITES.website,
        email: OPERATOR_REQUISITES.email,
        telephone: OPERATOR_REQUISITES.phone,
        description:
          "Информационно-аналитический онлайн-сервис для рекрутинговых агентств: радар компаний с активным наймом.",
        address: {
          "@type": "PostalAddress",
          addressLocality: OPERATOR_REQUISITES.city,
          addressCountry: "RU",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${OPERATOR_REQUISITES.website}/#website`,
        url: OPERATOR_REQUISITES.website,
        name: OPERATOR_REQUISITES.brandName,
        inLanguage: "ru-RU",
        publisher: { "@id": `${OPERATOR_REQUISITES.website}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${OPERATOR_REQUISITES.website}/#faq`,
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };

  return JSON.stringify(graph);
}
