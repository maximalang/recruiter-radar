import type { Metadata } from "next";

import { getPaymentProviderSetupState } from "../lib/payments";
import {
  buildCheckoutHref,
  hasPublicPreviewInput,
  readPublicPreviewInput,
  type PublicPreviewInput,
} from "../lib/publicProduct";
import { buildFaqItems } from "./home-page-components";
import LandingAnalytics from "./landing-analytics";
import LandingPage from "./landing/landing-page";
import WorkspaceScene, { WorkspaceResultsSkeleton } from "./landing/workspace-scene";
import { PageFrame } from "./ui/page-primitives";
import YandexMetrika from "./yandex-metrika";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruiter Radar — компании, которым стоит написать сегодня",
  description:
    "Recruiter Radar находит сигналы найма, показывает доказательства и помогает рекрутинговым агентствам выбрать безопасный момент для выхода на компанию.",
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
  const faqItems = buildFaqItems(paymentSetup.configured);
  const landing = LandingPage({
    previewInput,
    hasPreview,
    checkoutHref,
    paymentConfigured: paymentSetup.configured,
    faqItems,
  });

  return (
    <PageFrame maxWidth="none" dataDeployAnchor="recruiter-radar-landing-v3">
      <LandingAnalytics />
      {landing}
      <YandexMetrika />
    </PageFrame>
  );
}

/** Compatibility export for tests and server callers that render the workspace shell in isolation. */
export function PreviewSection(props: {
  previewInput: PublicPreviewInput;
  hasPreview: boolean;
  checkoutHref: string;
}) {
  return <WorkspaceScene {...props} />;
}

export function PreviewSkeleton() {
  return (
    <div id="preview-results" data-preview-results data-preview-results-skeleton aria-busy="true">
      <WorkspaceResultsSkeleton />
    </div>
  );
}
