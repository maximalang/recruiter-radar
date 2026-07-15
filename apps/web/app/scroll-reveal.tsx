import type { ReactNode } from "react";

/**
 * Semantic section wrapper that never hides product content.
 *
 * The old client-side intersection animation switched every below-fold section
 * to `opacity: 0` after hydration. Slow devices, full-page captures and missed
 * observer callbacks could then leave the landing visually empty. A marketing
 * page must remain readable independently of JavaScript and scroll timing, so
 * the wrapper is deliberately server-safe and permanently visible.
 */
export default function ScrollReveal({
  children,
  delay = 0,
  as: Tag = "div",
  className,
  style,
  id,
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "section";
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={className}
      style={{
        ...style,
        opacity: 1,
        transform: "none",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </Tag>
  );
}
