import Image from "next/image";

import logoMark from "../../public/favicon-brand19.png";
import s from "./brand-logo.module.css";

export function BrandLogo(props: {
  className?: string;
  tone?: "light" | "dark";
  size?: "default" | "small";
  priority?: boolean;
}) {
  const tone = props.tone ?? "light";
  const size = props.size ?? "default";

  return (
    <span
      className={`${s.logo}${props.className ? ` ${props.className}` : ""}`}
      data-tone={tone}
      data-size={size}
      data-mark="true"
      role="img"
      aria-label="Recruiter Radar"
    >
      <Image
        className={s.mark}
        src={logoMark}
        alt=""
        aria-hidden="true"
        priority={props.priority}
        sizes={size === "small" ? "28px" : "36px"}
      />
      <span className={s.wordmark} aria-hidden="true">
        <span>Recruiter</span>
        <span className={s.wordmarkAccent}>Radar</span>
      </span>
    </span>
  );
}
