"use client";

import { useFormStatus } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

export function FormSubmitButton(props: {
  idleLabel: ReactNode;
  pendingLabel: ReactNode;
  style?: CSSProperties;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={props.className} style={props.style} disabled={props.disabled || pending}>
      {pending ? props.pendingLabel : props.idleLabel}
    </button>
  );
}
