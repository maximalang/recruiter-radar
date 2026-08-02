import DetectionScene from "./detection-scene";
import LandingHeader from "./landing-header";
import styles from "./landing.module.css";

export default function LandingPage({ previewHref }: { previewHref: string }) {
  return (
    <div className={styles.landingPage} data-landing-experience="signal-lock">
      <LandingHeader previewHref={previewHref} />
      <main id="main-content">
        <DetectionScene previewHref={previewHref} />
      </main>
    </div>
  );
}
