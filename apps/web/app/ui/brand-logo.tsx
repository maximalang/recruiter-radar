import s from "./brand-logo.module.css";

export function BrandLogo(props: {
  className?: string;
  tone?: "light" | "dark";
  size?: "default" | "small";
  priority?: boolean;
  joined?: boolean;
}) {
  const tone = props.tone ?? "light";
  const size = props.size ?? "default";

  return (
    <span
      className={`${s.logo}${props.className ? ` ${props.className}` : ""}`}
      data-tone={tone}
      data-size={size}
      data-mark="false"
      role="img"
      aria-label="Recruiter Radar"
    >
      <span
        className={s.wordmark}
        aria-hidden="true"
        style={props.joined ? { gap: 0 } : undefined}
      >
        <span>Recruiter</span>
        <span className={s.wordmarkAccent}>Radar</span>
      </span>
    </span>
  );
}
