import type { PublicPreviewInput } from "../../lib/publicProduct";
import { SiteFooter } from "../ui/site-footer";
import { isYandexMetrikaConfigured } from "../../lib/analytics-config";
import ConversionPanel from "./conversion-panel";
import DeliveryScene from "./delivery-scene";
import DetectionScene from "./detection-scene";
import EvidenceScene from "./evidence-scene";
import frameStyles from "./landing-frame.module.css";
import LandingHeader from "./landing-header";
import LandingMotion from "./landing-motion";
import motionStyles from "./landing-motion.module.css";
import styles from "./landing.module.css";
import visualStyles from "./landing-visual-system.module.css";
import SignalTimeline from "./signal-timeline";

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
      className={`${styles.landingPage} ${frameStyles.frame} ${visualStyles.visualSystem} ${motionStyles.motionRoot}`}
      data-theme="inverse"
      data-landing-experience="signal-lock"
      data-landing-analytics={isYandexMetrikaConfigured() ? "enabled" : "disabled"}
    >
      <LandingMotion />
      <LandingHeader />
      <noscript>
        <div className={styles.noScriptNotice} data-noscript-disclosure role="note">
          Интерактивный пример в первом экране требует JavaScript; рассказ, тарифы и условия доступны без него.
        </div>
      </noscript>
      <main id="main-content">
        <DetectionScene paymentConfigured={props.paymentConfigured} />
        <SignalTimeline />
        <EvidenceScene />
        <DeliveryScene />
        <ConversionPanel
          previewInput={props.previewInput}
          paymentConfigured={props.paymentConfigured}
          faqItems={props.faqItems}
        />
      </main>
      <div className={styles.landingFooter} data-landing-footer="compact">
        <SiteFooter tone="light" showCookieSettings={isYandexMetrikaConfigured()} />
      </div>
    </div>
  );
}
