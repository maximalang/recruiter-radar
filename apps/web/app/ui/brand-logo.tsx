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
      role="img"
      aria-label="Recruiter Radar"
    >
      <img
        className={s.mark}
        src="/brand/recruiter-radar-mark.svg?v=brand-10"
        width={512}
        height={512}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      {showsWordmark ? (
        <span className={s.wordmark} aria-hidden="true">
          <span>Recruiter</span>
          <span className={s.wordmarkAccent}>Radar</span>
        </span>
      ) : null}
    </span>
  );
}
