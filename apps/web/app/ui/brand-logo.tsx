import s from "./brand-logo.module.css";

export function BrandLogo(props: {
  className?: string;
  tone?: "light" | "dark";
  size?: "default" | "small";
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
      <span className={s.wordmark} aria-hidden="true">
        <span>Recruiter</span>
        <span className={s.wordmarkAccent}>Radar</span>
      </span>
    </span>
  );
}
