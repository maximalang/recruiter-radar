import type { PublicPreviewInput } from "../../lib/publicProduct";
import { SiteFooter } from "../ui/site-footer";
import ConversionPanel from "./conversion-panel";
import DeliveryScene from "./delivery-scene";
import DetectionScene from "./detection-scene";
import EvidenceScene from "./evidence-scene";
import frameStyles from "./landing-frame.module.css";
import LandingHashNavigation from "./landing-hash-navigation";
import LandingHeader from "./landing-header";
import styles from "./landing.module.css";
import OutreachScene from "./outreach-scene";
import SignalTimelineScene from "./signal-timeline-scene";
import WorkspaceScene from "./workspace-scene";

export default function LandingPage(props: {
  previewInput: PublicPreviewInput;
  hasPreview: boolean;
  checkoutHref: string;
  paymentConfigured: boolean;
  faqItems: ReadonlyArray<{ question: string; answer: string }>;
}) {
  return (
    <div className={`${styles.landingPage} ${frameStyles.frame}`} data-landing-experience="signal-lock">
      <a href="#main-content" className={styles.skipLink}>Перейти к содержанию</a>
      <LandingHashNavigation />
      <LandingHeader previewHref="#preview-configurator" />
      <main id="main-content">
        <DetectionScene previewHref="#preview-configurator" />
        <SignalTimelineScene />
        <WorkspaceScene
          previewInput={props.previewInput}
          hasPreview={props.hasPreview}
          checkoutHref={props.checkoutHref}
        />
        <EvidenceScene />
        <DeliveryScene />
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
