import s from "./brand-logo.module.css";

export function BrandLogo(props: {
  className?: string;
  tone?: "light" | "dark";
  size?: "default" | "small";
  priority?: boolean;
  joined?: boolean;
  showMark?: boolean;
}) {
  const tone = props.tone ?? "light";
  const size = props.size ?? "default";
  const joined = props.joined ?? true;

  return (
    <span
      className={`${s.logo}${props.className ? ` ${props.className}` : ""}`}
      data-tone={tone}
      data-size={size}
      data-mark={props.showMark ? "true" : "false"}
      role="img"
      aria-label="Recruiter Radar"
    >
      {props.showMark ? (
        <img
          src="/recruiter-radar-app-source.svg"
          width="36"
          height="36"
          className={s.mark}
          alt=""
          aria-hidden="true"
          fetchPriority={props.priority ? "high" : "auto"}
        />
      ) : null}
      <span
        className={s.wordmark}
        aria-hidden="true"
        style={joined ? { gap: 0 } : undefined}
      >
        <span>Recruiter</span>
        <span className={s.wordmarkAccent}>Radar</span>
      </span>
    </span>
  );
}
