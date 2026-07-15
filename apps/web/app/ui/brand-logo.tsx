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
      <img
        className={s.artwork}
        src="/brand/recruiter-radar-logo.svg?v=vector-3"
        width={728}
        height={252}
        alt="Recruiter Radar"
        draggable={false}
      />
    </span>
  );
}
