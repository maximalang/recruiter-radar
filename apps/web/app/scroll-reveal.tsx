import type { CSSProperties, ReactNode } from "react";

export default function ScrollReveal({
  children,
  as: Tag = "div",
  className,
  style,
  id,
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "section";
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <Tag id={id} className={className} style={style}>
      {children}
    </Tag>
  );
}
