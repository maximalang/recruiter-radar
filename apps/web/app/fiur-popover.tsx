"use client";

import { useEffect, useId, useRef, useState } from "react";

import hpStyles from "./home-page-components.module.css";

export default function FiurPopover(props: {
  label: string;
  secondaryLabel: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      triggerRef.current?.focus();
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={hpStyles.fiurPopover}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span className={hpStyles.fiurPopoverLabel}>
        {props.label}
        <small>{props.secondaryLabel}</small>
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={hpStyles.fiurPopoverTrigger}
        aria-label={`Что означает «${props.label}»`}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen((value) => !value)}
      >
        i
      </button>
      {open ? (
        <span id={tooltipId} className={hpStyles.fiurPopoverBody} role="tooltip">
          {props.description}
        </span>
      ) : null}
    </span>
  );
}
