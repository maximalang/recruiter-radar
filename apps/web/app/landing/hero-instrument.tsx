import styles from "./landing.module.css";

type HeroInstrumentProps = {
  companyName: string;
  signalLabel: string;
  score: number;
  confidence: string;
  freshness: string;
};

/** Replaceable hero visualization boundary fed only by product facts. */
export default function HeroInstrument({
  companyName,
  signalLabel,
  score,
  confidence,
  freshness,
}: HeroInstrumentProps) {
  return (
    <figure className={styles.heroInstrument} aria-label={`Инструмент доказательств для ${companyName}`}>
      <svg
        className={styles.instrumentField}
        viewBox="0 0 760 760"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${signalLabel}. Оценка ${score} из 100, уровень уверенности ${confidence}.`}
      >
        <defs>
          <radialGradient id="instrument-wash" cx="52%" cy="48%" r="58%">
            <stop offset="0" stopColor="#c8f36a" stopOpacity=".09" />
            <stop offset=".58" stopColor="#18201d" stopOpacity=".08" />
            <stop offset="1" stopColor="#070a09" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="760" height="760" fill="url(#instrument-wash)" />
        <g className={styles.instrumentRings} fill="none" aria-hidden="true">
          <circle cx="380" cy="380" r="112" />
          <circle cx="380" cy="380" r="214" />
          <circle cx="380" cy="380" r="314" />
        </g>
        <g className={styles.instrumentQuietNodes} aria-hidden="true">
          <circle cx="226" cy="266" r="2.5" opacity=".42" />
          <circle cx="244" cy="282" r="3.5" opacity=".72" />
          <circle cx="258" cy="258" r="2" opacity=".34" />
          <circle cx="536" cy="346" r="2.5" opacity=".48" />
          <circle cx="552" cy="354" r="3.5" opacity=".66" />
          <circle cx="568" cy="338" r="2" opacity=".3" />
          <circle cx="224" cy="498" r="2" opacity=".36" />
          <circle cx="240" cy="512" r="3" opacity=".56" />
          <circle cx="466" cy="552" r="2.5" opacity=".44" />
          <circle cx="484" cy="540" r="3" opacity=".6" />
          <circle cx="314" cy="206" r="2" opacity=".3" />
          <circle cx="330" cy="214" r="2.5" opacity=".46" />
          <circle cx="586" cy="470" r="2" opacity=".32" />
        </g>
        <g className={styles.instrumentActiveNode} aria-hidden="true">
          <circle cx="508" cy="238" r="4.5" />
          <circle cx="508" cy="238" r="24" />
          <circle cx="508" cy="238" r="44" />
        </g>
      </svg>

      <figcaption className={styles.instrumentCaption}>
        <span>Подтверждённый сигнал / текущий приоритет</span>
        <div>
          <strong>{signalLabel}</strong>
          <small>{freshness} · уверенность {confidence}</small>
        </div>
        <b>{score}<small>/100</small></b>
      </figcaption>
    </figure>
  );
}
