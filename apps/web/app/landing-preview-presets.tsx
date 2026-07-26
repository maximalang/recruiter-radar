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
  const initialIndex = options.findIndex((option) => option.selected);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    initialIndex >= 0 ? initialIndex : null,
  );
  const optionRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  useEffect(() => {
    const nextIndex = options.findIndex((option) => option.selected);
    setSelectedIndex(nextIndex >= 0 ? nextIndex : null);
  }, [options]);

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    setSelectedIndex(index);
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
    if (event.key === "Enter" || event.key === " ") nextIndex = index;
    if (nextIndex === null) return;

    event.preventDefault();
    select(nextIndex);
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
          tabIndex={selectedIndex === index || (selectedIndex === null && index === 0) ? 0 : -1}
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
