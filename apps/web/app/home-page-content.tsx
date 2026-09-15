import type { Metadata } from "next";

import { getPaymentProviderSetupState } from "../lib/payments";
import {
  buildCheckoutHref,
  hasPublicPreviewInput,
  readPublicPreviewInput,
} from "../lib/publicProduct";
import LandingAnalytics from "./landing-analytics";
import { buildLandingFaqItems } from "./landing/landing-faq";
import LandingPage, { LandingSkipLink } from "./landing/landing-page";
import { PageFrame } from "./ui/page-primitives";
import YandexMetrika from "./yandex-metrika";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruiter Radar — компании, которым стоит написать сегодня",
  description:
    "Recruiter Radar находит для рекрутинговых агентств компании с растущим наймом и объясняет, почему писать им стоит именно сейчас: факты, источники и официальный путь контакта по каждой компании.",
};

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const previewInput = readPublicPreviewInput(resolvedSearchParams);
  const hasPreview = hasPublicPreviewInput(previewInput);
  const checkoutHref = buildCheckoutHref(previewInput);
  const paymentSetup = getPaymentProviderSetupState();
  const faqItems = buildLandingFaqItems(paymentSetup.configured);
  const landing = LandingPage({
    previewInput,
    hasPreview,
    checkoutHref,
    paymentConfigured: paymentSetup.configured,
    faqItems,
  });

  return (
    <PageFrame
      as="div"
      maxWidth="none"
      layout="landing"
      dataDeployAnchor="recruiter-radar-landing-v3"
    >
      <LandingSkipLink />
      <LandingAnalytics />
      {landing}
      <YandexMetrika />
    </PageFrame>
  );
}
