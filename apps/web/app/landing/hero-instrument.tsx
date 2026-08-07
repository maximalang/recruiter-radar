import instrumentStyles from "./hero-instrument.module.css";
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
    <figure
      className={`${styles.heroInstrument} ${instrumentStyles.compass}`}
      aria-label={`Инструмент доказательств для ${companyName}`}
      data-hero-instrument="true"
    >
      <svg
        className={`${styles.instrumentField} ${instrumentStyles.field}`}
        viewBox="0 0 760 760"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${signalLabel}. Оценка ${score} из 100, уровень уверенности ${confidence}.`}
      >
        <defs>
          <radialGradient id="instrument-wash" cx="57%" cy="42%" r="58%">
            <stop offset="0" stopColor="#9ed7c4" stopOpacity=".075" />
            <stop offset=".52" stopColor="#151d18" stopOpacity=".025" />
            <stop offset="1" stopColor="#080c0a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="active-illumination" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#b5ead8" stopOpacity=".12" />
            <stop offset=".62" stopColor="#b5ead8" stopOpacity=".035" />
            <stop offset="1" stopColor="#b5ead8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="760" height="760" fill="url(#instrument-wash)" />

        <circle className={instrumentStyles.outerRing} cx="380" cy="380" r="326" aria-hidden="true" />
        <g className={instrumentStyles.rings} aria-hidden="true" data-radar-rings="true">
          <circle cx="380" cy="380" r="118" />
          <circle cx="380" cy="380" r="218" />
          <circle cx="380" cy="380" r="302" />
        </g>

        <g className={instrumentStyles.brokenArcs} aria-hidden="true">
          <path d="M164 139a326 326 0 0 1 107-62" />
          <path d="M624 165a326 326 0 0 1 66 104" />
          <path d="M662 547a326 326 0 0 1-70 91" />
        </g>

        <g className={instrumentStyles.ticks} aria-hidden="true">
          <line x1="380" y1="48" x2="380" y2="60" />
          <line x1="428" y1="52" x2="426" y2="63" />
          <line x1="476" y1="62" x2="472" y2="72" />
          <line x1="633" y1="159" x2="624" y2="166" />
          <line x1="670" y1="206" x2="659" y2="211" />
          <line x1="704" y1="374" x2="692" y2="374" />
          <line x1="682" y1="503" x2="671" y2="499" />
          <line x1="594" y1="641" x2="586" y2="632" />
          <line x1="236" y1="671" x2="241" y2="660" />
          <line x1="114" y1="586" x2="123" y2="578" />
          <line x1="55" y1="411" x2="67" y2="410" />
          <line x1="91" y1="252" x2="102" y2="257" />
        </g>

        <g className={instrumentStyles.marks} aria-hidden="true">
          <path d="M380 40v18" />
          <path d="M720 380h-18" />
          <path d="M380 720v-18" />
          <path d="M40 380h18" />
          <path d="M618 142l-10 11" />
          <path d="M620 618l-11-10" />
        </g>

        <g className={instrumentStyles.labels} aria-hidden="true">
          <text x="396" y="53">N-04</text>
          <text x="658" y="193">E-12</text>
          <text x="651" y="532">Q-08</text>
          <text x="114" y="594">W-03</text>
          <text x="86" y="245">SRC/7</text>
        </g>

        <g className={instrumentStyles.ambient} aria-hidden="true" data-signal-field="ambient">
          <circle cx="172" cy="327" r="1" opacity=".22" />
          <circle cx="205" cy="205" r="1.3" opacity=".26" />
          <circle cx="287" cy="126" r=".9" opacity=".2" />
          <circle cx="346" cy="173" r="1.1" opacity=".24" />
          <circle cx="454" cy="144" r="1" opacity=".18" />
          <circle cx="611" cy="292" r="1.2" opacity=".26" />
          <circle cx="641" cy="405" r="1" opacity=".19" />
          <circle cx="585" cy="522" r="1.4" opacity=".27" />
          <circle cx="503" cy="611" r="1" opacity=".2" />
          <circle cx="344" cy="638" r="1.2" opacity=".24" />
          <circle cx="235" cy="585" r=".9" opacity=".18" />
          <circle cx="131" cy="461" r="1.3" opacity=".23" />
          <circle cx="285" cy="338" r="1" opacity=".17" />
          <circle cx="436" cy="428" r="1.2" opacity=".2" />
        </g>

        <g className={instrumentStyles.clusterPrimary} aria-hidden="true" data-signal-cluster="primary">
          <circle cx="231" cy="266" r="2.6" opacity=".78" />
          <circle cx="243" cy="254" r="1.6" opacity=".48" />
          <circle cx="252" cy="274" r="2" opacity=".62" />
          <circle cx="263" cy="260" r="1.3" opacity=".4" />
          <circle cx="271" cy="282" r="1.8" opacity=".55" />
          <circle cx="221" cy="282" r="1.2" opacity=".34" />
        </g>

        <g className={instrumentStyles.clusterSecondary} aria-hidden="true" data-signal-cluster="secondary">
          <circle cx="302" cy="542" r="2.4" opacity=".68" />
          <circle cx="315" cy="531" r="1.4" opacity=".38" />
          <circle cx="326" cy="548" r="1.9" opacity=".54" data-tone="secondary" />
          <circle cx="336" cy="535" r="1.2" opacity=".34" />
          <circle cx="345" cy="554" r="1.6" opacity=".48" />
        </g>

        <g className={instrumentStyles.clusterLinks} aria-hidden="true" data-signal-links="true">
          <path d="M231 266 243 254 252 274 271 282" />
          <path d="M302 542 315 531 326 548 345 554" />
          <path d="M527 246 542 232 556 245 565 261" />
        </g>

        <circle className={instrumentStyles.activeIllumination} cx="548" cy="246" r="76" aria-hidden="true" />
        <g className={instrumentStyles.activeCluster} aria-hidden="true" data-active-signal="true">
          <circle className={instrumentStyles.dominant} cx="548" cy="246" r="4.2" />
          <circle cx="535" cy="236" r="2.1" opacity=".72" />
          <circle cx="558" cy="232" r="1.8" opacity=".58" />
          <circle cx="566" cy="249" r="2.4" opacity=".66" />
          <circle cx="537" cy="258" r="1.5" opacity=".5" />
          <circle cx="555" cy="263" r="1.7" opacity=".54" data-tone="secondary" />
          <circle cx="525" cy="248" r="1.2" opacity=".38" />
        </g>
      </svg>

      <figcaption className={`${styles.instrumentCaption} ${instrumentStyles.caption}`}>
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
