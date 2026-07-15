import s from "./brand-logo.module.css";

export function BrandLogo(props: {
  className?: string;
  tone?: "light" | "dark";
  size?: "default" | "small";
  showWordmark?: boolean;
}) {
  const tone = props.tone ?? "light";
  const size = props.size ?? "default";
  const showsWordmark = props.showWordmark !== false;

  return (
    <span
      className={`${s.logo}${props.className ? ` ${props.className}` : ""}`}
      data-tone={tone}
      data-size={size}
      data-wordmark={showsWordmark ? "true" : "false"}
    >
      <svg
        className={s.artwork}
        viewBox={showsWordmark ? "0 0 640 220" : "0 0 212 212"}
        width={showsWordmark ? 640 : 212}
        height={showsWordmark ? 220 : 212}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Recruiter Radar"
      >
        <g transform="translate(4 4)">
          <circle
            className={s.primaryStroke}
            cx="104"
            cy="104"
            r="86"
            strokeWidth="5.5"
            strokeDasharray="118 20 85 17 92 20 120 34"
            transform="rotate(-72 104 104)"
          />
          <path
            className={s.primaryStroke}
            d="M104 6v27M104 175v27M6 104h31M171 104h31"
            strokeWidth="3.5"
          />
          <circle
            className={s.primaryStroke}
            cx="104"
            cy="104"
            r="57"
            strokeWidth="2.5"
            strokeDasharray="188 35 95 40"
            transform="rotate(-100 104 104)"
          />
          <circle
            className={s.accentStroke}
            cx="104"
            cy="104"
            r="31"
            strokeWidth="3"
            strokeDasharray="105 90"
            transform="rotate(28 104 104)"
          />
          <circle className={s.primaryFill} cx="104" cy="104" r="9" />
          <circle className={s.signalFill} cx="151" cy="61" r="10" />
          <circle className={s.accentFill} cx="126" cy="159" r="7.5" />
          <circle className={s.primaryFill} cx="50" cy="137" r="6.2" />
          <text className={`${s.monogram} ${s.primaryFill}`} x="18" y="105" fontSize="78">
            R
          </text>
          <text className={`${s.monogram} ${s.accentFill}`} x="119" y="187" fontSize="82">
            R
          </text>
        </g>

        {showsWordmark ? (
          <g className={s.wordmark}>
            <text className={s.primaryFill} x="224" y="99" fontSize="68">
              Recruiter
            </text>
            <text className={s.accentFill} x="224" y="179" fontSize="77">
              Radar
            </text>
          </g>
        ) : null}
      </svg>
    </span>
  );
}
