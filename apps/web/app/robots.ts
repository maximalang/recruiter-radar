import type { MetadataRoute } from "next";

import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";

/**
 * robots.txt: открыт для поисковых систем и AI-краулеров (AEO/GEO).
 * Продукт — публичный B2B-лендинг; скрывать извлечение смысла не имеет,
 * приватные зоны (/dashboard, /admin, API) закрыты авторизацией.
 * Служебные пути исключены из обхода явно.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/admin", "/settings", "/onboarding", "/checkout"],
      },
    ],
    sitemap: `${OPERATOR_REQUISITES.website}/sitemap.xml`,
    host: OPERATOR_REQUISITES.website,
  };
}
