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
import LandingMotion from "./landing-motion";
import motionStyles from "./landing-motion.module.css";
import styles from "./landing.module.css";
import visualStyles from "./landing-visual-system.module.css";
import SignalTimeline from "./signal-timeline";
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
      className={`${styles.landingPage} ${frameStyles.frame} ${visualStyles.visualSystem} ${motionStyles.motionRoot}`}
      data-landing-experience="signal-lock"
    >
      <LandingMotion />
      <LandingHashNavigation />
      <LandingHeader previewHref="#preview-configurator" />
      <noscript>
        <div className={styles.noScriptNotice} data-noscript-disclosure role="note">
          Интерактивная настройка примера требует JavaScript. Основная информация о продукте, тарифах и условиях остаётся доступна без него.
        </div>
      </noscript>
      <main id="main-content">
        <DetectionScene previewHref="#preview-configurator" paymentConfigured={props.paymentConfigured} />
        <SignalTimeline />
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
      <div className={styles.landingFooter} data-landing-footer="compact">
        <SiteFooter tone="light" showCookieSettings={isYandexMetrikaConfigured()} />
      </div>
    </div>
  );
}
