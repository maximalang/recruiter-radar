"use client";

import { useTransition } from "react";
import { logoutOperator } from "./admin-actions";

/** Small inline button that clears the operator session cookie. */
export default function AdminLogoutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => logoutOperator())}
      style={{
        background: "transparent",
        color: "var(--rr-color-text-secondary)",
        padding: "8px 16px",
        borderRadius: "10px",
        fontWeight: 600,
        fontSize: "var(--rr-type-metadata-size)",
        border: "1px solid var(--rr-color-separator)",
        cursor: pending ? "wait" : "pointer",
        opacity: pending ? 0.7 : 1,
        justifySelf: "end",
      }}
    >
      {pending ? "Выход…" : "Выйти"}
    </button>
  );
}
