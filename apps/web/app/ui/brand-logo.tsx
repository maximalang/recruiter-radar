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
        viewBox="0 0 32 32"
        role={showsWordmark ? undefined : "img"}
        aria-hidden={showsWordmark ? "true" : undefined}
        aria-label={showsWordmark ? undefined : "Recruiter Radar"}
      >
        <path className={s.orbit} d="M5 22.5A12.5 12.5 0 0 1 22.5 5" />
        <path className={s.orbitSoft} d="M9.6 20.7A8 8 0 0 1 20.7 9.6" />
        <path className={s.needle} d="M15.6 16.4 26.8 5.2 20.4 19.1Z" />
        <circle className={s.origin} cx="15.6" cy="16.4" r="2.25" />
        <circle className={s.target} cx="26.8" cy="5.2" r="1.65" />
        <path className={s.monogram} d="M15.6 18.7v8.1m0 0h7.5" />
      </svg>
      {showsWordmark ? (
        <span className={s.wordmark}>Recruiter <strong>Radar</strong></span>
      ) : null}
    </span>
  );
}
