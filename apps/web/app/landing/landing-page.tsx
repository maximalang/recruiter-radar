import { Suspense } from "react";

import type { PublicPreviewInput } from "../../lib/publicProduct";
import { SiteFooter } from "../ui/site-footer";
import ConversionPanel from "./conversion-panel";
import DetectionScene from "./detection-scene";
import EvidenceScene from "./evidence-scene";
import LandingHeader from "./landing-header";
import OutreachScene from "./outreach-scene";
import styles from "./landing.module.css";
import SignalTimelineScene from "./signal-timeline-scene";
import WorkspaceScene, { WorkspaceSkeleton } from "./workspace-scene";

export default function LandingPage(props: {
  previewInput: PublicPreviewInput;
  hasPreview: boolean;
  checkoutHref: string;
  paymentConfigured: boolean;
  faqItems: ReadonlyArray<{ question: string; answer: string }>;
}) {
  return (
    <div className={styles.landingPage} data-landing-experience="signal-lock">
      <a href="#main-content" className={styles.skipLink}>Перейти к содержанию</a>
      <LandingHeader previewHref="#preview-configurator" />
      <main id="main-content">
        <DetectionScene previewHref="#preview-configurator" />
        <Suspense fallback={<WorkspaceSkeleton />}>
          <WorkspaceScene {...props} showConversionPanel={false} />
        </Suspense>
        <SignalTimelineScene />
        <EvidenceScene />
        <OutreachScene />
        <ConversionPanel
          previewInput={props.previewInput}
          paymentConfigured={props.paymentConfigured}
          faqItems={props.faqItems}
        />
      </main>
      <SiteFooter tone="dark" />
    </div>
  );
}