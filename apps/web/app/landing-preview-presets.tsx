"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import hpStyles from "./home-page-components.module.css";

export type LandingPreviewPresetOption = {
  label: string;
  href: string;
  selected: boolean;
};

export default function LandingPreviewPresets({
  options,
}: {
  options: LandingPreviewPresetOption[];
}) {
  const initialIndex = Math.max(0, options.findIndex((option) => option.selected));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const optionRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  useEffect(() => {
    setSelectedIndex(Math.max(0, options.findIndex((option) => option.selected)));
  }, [options]);

  const select = (index: number, emitAnalytics = true) => {
    const option = options[index];
    if (!option) return;
    setSelectedIndex(index);
    if (emitAnalytics) {
      window.dispatchEvent(
        new CustomEvent("landing:analytics", {
          detail: { name: "preview_started", context: "preset" },
        }),
      );
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const lastIndex = options.length - 1;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = index === lastIndex ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = index === 0 ? lastIndex : index - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    select(nextIndex, false);
    optionRefs.current[nextIndex]?.focus();
    optionRefs.current[nextIndex]?.click();
  };

  return (
    <div
      className={hpStyles.previewPresets}
      role="radiogroup"
      aria-label="Готовые профили радара"
    >
      {options.map((option, index) => (
        <Link
          key={option.label}
          ref={(element) => {
            optionRefs.current[index] = element;
          }}
          href={option.href}
          role="radio"
          aria-checked={selectedIndex === index}
          tabIndex={selectedIndex === index ? 0 : -1}
          data-preview-preset
          data-selected={selectedIndex === index}
          onClick={() => select(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
