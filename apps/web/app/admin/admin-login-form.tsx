"use client";

import { useActionState } from "react";
import { loginOperator } from "./admin-actions";

/**
 * Login form for the operator panel. Uses the loginOperator server action via
 * useActionState so the password is POSTed server-side and never exposed to
 * client JS state. On success the action sets the signed rr_op cookie and
 * revalidates /admin, so the page flips to the operator console.
 */
export default function AdminLoginForm() {
  const [state, formAction, pending] = useActionState(loginOperator, { ok: false, error: null });

  return (
    <form action={formAction} style={{ display: "grid", gap: "12px", maxWidth: "380px" }}>
      <label style={{ display: "grid", gap: "6px" }}>
        <span style={{ fontSize: "var(--type-metadata-size)", fontWeight: 600, color: "var(--color-text-secondary)" }}>
          Пароль оператора
        </span>
        <input
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="••••••••"
          style={{
            fontSize: "var(--type-body-size)",
            padding: "12px 16px",
            border: "1px solid var(--color-separator)",
            borderRadius: "12px",
            width: "100%",
          }}
        />
      </label>

      {state.error ? (
        <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#fee4e2", color: "#b42318", fontSize: "0.86rem" }}>
          {state.error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        style={{
          background: "var(--color-signal)",
          color: "#fff",
          padding: "12px 22px",
          borderRadius: "12px",
          fontWeight: 600,
          fontSize: "var(--type-body-size)",
          border: "none",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
          justifySelf: "start",
        }}
      >
        {pending ? "Вход…" : "Войти"}
      </button>
    </form>
  );
}
