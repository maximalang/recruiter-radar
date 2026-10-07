import type { MetadataRoute } from "next";

import { OPERATOR_REQUISITES } from "@/lib/operatorRequisites";

const SITE_URL = OPERATOR_REQUISITES.website;

/**
 * Карта сайта: только публичные контентные маршруты.
 * Личное пространство кабинета и страница входа в индекс не входят.
 * lastModified пересчитывается на каждой сборке — честная дата изменения контента.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const entry = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
  ): MetadataRoute.Sitemap[number] => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    entry("/", 1.0, "weekly"),
    entry("/legal", 0.4, "yearly"),
    entry("/terms", 0.4, "yearly"),
    entry("/privacy", 0.4, "yearly"),
    entry("/personal-data-consent", 0.3, "yearly"),
    entry("/payment-and-refund", 0.3, "yearly"),
    entry("/offer", 0.5, "monthly"),
  ];
}
