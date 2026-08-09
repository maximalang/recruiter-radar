import type { PublicPreviewInput } from "../../lib/publicProduct";
import { SiteFooter } from "../ui/site-footer";
import { isYandexMetrikaConfigured } from "../../lib/analytics-config";
import ConversionPanel from "./conversion-panel";
import DeliveryScene from "./delivery-scene";
import DetectionScene from "./detection-scene";
import EvidenceScene from "./evidence-scene";
import frameStyles from "./landing-frame.module.css";
import LandingHashNavigation from "./landing-hash-navigation";
import LandingHeader from "./landing-header";
import styles from "./landing.module.css";
import visualStyles from "./landing-visual-system.module.css";
import WorkspaceScene from "./workspace-scene";

export function LandingSkipLink() {
  return <a href="#main-content" className={styles.skipLink}>Перейти к содержанию</a>;
}

export default function LandingPage(props: {
  previewInput: PublicPreviewInput;
  hasPreview: boolean;
  checkoutHref: string;
  paymentConfigured: boolean;
  faqItems: ReadonlyArray<{ question: string; answer: string }>;
}) {
  return (
    <div
      className={`${styles.landingPage} ${frameStyles.frame} ${visualStyles.visualSystem}`}
      data-landing-experience="signal-lock"
    >
      <LandingHashNavigation />
      <LandingHeader previewHref="#preview-configurator" />
      <main id="main-content">
        <DetectionScene previewHref="#preview-configurator" paymentConfigured={props.paymentConfigured} />
        <WorkspaceScene
          previewInput={props.previewInput}
          hasPreview={props.hasPreview}
          checkoutHref={props.checkoutHref}
        />
        <EvidenceScene />
        <DeliveryScene />
        <ConversionPanel
          previewInput={props.previewInput}
          paymentConfigured={props.paymentConfigured}
          faqItems={props.faqItems}
        />
      </main>
      <SiteFooter tone="dark" showCookieSettings={isYandexMetrikaConfigured()} />
    </div>
  );
}
