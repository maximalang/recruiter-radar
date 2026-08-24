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
        color: "var(--color-text-secondary)",
        padding: "8px 16px",
        borderRadius: "var(--radius-surface)",
        fontWeight: 600,
        fontSize: "var(--type-metadata-size)",
        border: "1px solid var(--color-separator)",
        cursor: pending ? "wait" : "pointer",
        opacity: pending ? 0.7 : 1,
        justifySelf: "end",
      }}
    >
      {pending ? "Выход…" : "Выйти"}
    </button>
  );
}
