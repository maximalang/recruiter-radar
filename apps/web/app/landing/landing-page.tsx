import { Suspense } from "react";

import type { PublicPreviewInput } from "../../lib/publicProduct";
import { SiteFooter } from "../ui/site-footer";
import DetectionScene from "./detection-scene";
import EvidenceScene from "./evidence-scene";
import LandingHashNavigation from "./landing-hash-navigation";
import LandingHeader from "./landing-header";
import OutreachScene from "./outreach-scene";
import correctionStyles from "./landing-corrections.module.css";
import frameStyles from "./landing-frame.module.css";
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
    <div
      className={`${styles.landingPage} ${correctionStyles.root} ${frameStyles.frame}`}
      data-landing-experience="signal-lock"
    >
      <a href="#main-content" className={styles.skipLink}>Перейти к содержанию</a>
      <LandingHashNavigation />
      <LandingHeader previewHref="#preview-configurator" />
      <main id="main-content">
        <DetectionScene previewHref="#preview-configurator" />
        <SignalTimelineScene />
        <EvidenceScene />
        <OutreachScene />
        <Suspense fallback={<WorkspaceSkeleton />}>
          <WorkspaceScene {...props} />
        </Suspense>
      </main>
      <SiteFooter tone="dark" />
    </div>
  );
}
