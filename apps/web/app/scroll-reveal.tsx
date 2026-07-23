"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

import { useLandingMotion } from "./landing-motion/landing-motion-provider";

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
  style?: CSSProperties;
  id?: string;
}) {
  const motion = useLandingMotion();
  const elementRef = useRef<HTMLElement | null>(null);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    if (
      !element ||
      hasAnimatedRef.current ||
      motion.paused ||
      motion.reduced ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    let animation: Animation | null = null;
    const cleanupStyles = () => {
      element.style.removeProperty("will-change");
      element.style.opacity = "1";
      element.style.transform = "none";
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (
        hasAnimatedRef.current ||
        !entry?.isIntersecting ||
        entry.intersectionRatio < 0.12
      ) {
        return;
      }
      observer.disconnect();
      hasAnimatedRef.current = true;
      try {
        element.style.willChange = "opacity, transform";
        animation = element.animate(
          [
            { opacity: 0.86, transform: "translateY(10px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 520,
            delay,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            fill: "none",
          },
        );
        void animation.finished.catch(() => {}).finally(cleanupStyles);
      } catch {
        cleanupStyles();
      }
    }, {
      rootMargin: "0px 0px -8%",
      threshold: [0.12],
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      animation?.cancel();
      cleanupStyles();
    };
  }, [delay, motion.paused, motion.reduced]);

  return (
    <Tag
      ref={(node) => {
        elementRef.current = node;
      }}
      id={id}
      className={className}
      style={{
        ...style,
        opacity: 1,
        transform: "none",
      }}
    >
      {children}
    </Tag>
  );
}
