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
    >
      <svg
        className={s.mark}
        viewBox="0 0 36 36"
        role={showsWordmark ? undefined : "img"}
        aria-hidden={showsWordmark ? "true" : undefined}
        aria-label={showsWordmark ? undefined : "Recruiter Radar"}
      >
        <defs>
          <linearGradient id="rr-mark" x1="5" y1="3" x2="31" y2="33" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0B1324" />
            <stop offset="0.58" stopColor="#163B78" />
            <stop offset="1" stopColor="#3977EE" />
          </linearGradient>
          <linearGradient id="rr-sweep" x1="17" y1="18" x2="28" y2="7" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" stopOpacity="0.35" />
            <stop offset="1" stopColor="#BBD5FF" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="34" height="34" rx="10" fill="url(#rr-mark)" />
        <path d="M8.7 22.8A10.5 10.5 0 0 1 23.2 8.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.24" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M12.2 21A6.6 6.6 0 0 1 21.1 12" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.55" strokeLinecap="round" />
        <circle cx="17.2" cy="18.3" r="2.15" fill="#FFFFFF" />
        <path d="M17.2 18.3L27.2 7.7L22.1 21.4Z" fill="url(#rr-sweep)" fillOpacity="0.88" />
        <circle cx="27.2" cy="7.7" r="1.55" fill="#9CC2FF" />
        <path d="M17.2 18.3v9.1M17.2 27.4h7.1" fill="none" stroke="#FFFFFF" strokeOpacity="0.78" strokeWidth="1.65" strokeLinecap="round" />
      </svg>
      {showsWordmark ? (
        <span className={s.wordmark}>Recruiter <strong>Radar</strong></span>
      ) : null}
    </span>
  );
}
