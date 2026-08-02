import { Suspense } from "react";

import type { PublicPreviewInput } from "../../lib/publicProduct";
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
}) {
  return (
    <div className={styles.landingPage} data-landing-experience="signal-lock">
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
    </div>
  );
}
