import DetectionScene from "./detection-scene";
import EvidenceScene from "./evidence-scene";
import LandingHeader from "./landing-header";
import styles from "./landing.module.css";
import SignalTimelineScene from "./signal-timeline-scene";

export default function LandingPage({ previewHref }: { previewHref: string }) {
  return (
    <div className={styles.landingPage} data-landing-experience="signal-lock">
      <LandingHeader previewHref={previewHref} />
      <main id="main-content">
        <DetectionScene previewHref={previewHref} />
        <SignalTimelineScene />
        <EvidenceScene />
      </main>
    </div>
  );
}
