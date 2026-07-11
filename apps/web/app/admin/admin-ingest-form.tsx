"use client";

import { useActionState, useState } from "react";
import { runIngest } from "./admin-actions";

/**
 * Operator ingest trigger. Uses the runIngest server action via useActionState.
 * No API key is entered here — the action auths via the signed operator session
 * cookie set at login. The action can take >60s (career-pages crawl under a
 * 90s budget), so the button shows a busy state.
 */
export default function AdminIngestForm() {
  const [mode, setMode] = useState<"all" | "single">("all");
  const [source, setSource] = useState("");
  const [state, formAction, pending] = useActionState(runIngest, {
    ok: false,
    message: "",
  });

  return (
    <form action={formAction} style={{ display: "grid", gap: "12px" }}>
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="source" value={mode === "single" ? source : ""} />

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "0.86rem" }}>
          <input type="radio" name="mode-radio" checked={mode === "all"} onChange={() => setMode("all")} />
          Все primary
        </label>
        <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "0.86rem" }}>
          <input type="radio" name="mode-radio" checked={mode === "single"} onChange={() => setMode("single")} />
          Один источник
        </label>
        {mode === "single" ? (
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="career-pages / habr / rabota-rossii"
            style={{
              fontSize: "var(--fs-base)",
              padding: "8px 12px",
              border: "1px solid var(--c-border, #e2e8f0)",
              borderRadius: "10px",
            }}
          />
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        style={{
          background: "var(--c-brand, #1d4ed8)",
          color: "#fff",
          padding: "12px 22px",
          borderRadius: "12px",
          fontWeight: 600,
          fontSize: "var(--fs-base)",
          border: "none",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
          justifySelf: "start",
        }}
      >
        {pending ? "Запуск… (до 90с)" : "Запустить инжест"}
      </button>

      {state.message ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "10px",
            background: state.ok ? "#d1fae5" : "#fee4e2",
            color: state.ok ? "#065f46" : "#b42318",
            fontSize: "0.86rem",
          }}
        >
          {state.message}
        </div>
      ) : null}

      {state.results && state.results.length > 0 ? (
        <div style={{ display: "grid", gap: "6px" }}>
          {state.results.map((r) => (
            <div
              key={r.source}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: "12px",
                alignItems: "center",
                padding: "8px 12px",
                border: "1px solid var(--c-border, #e2e8f0)",
                borderRadius: "10px",
                fontSize: "0.82rem",
              }}
            >
              <strong>{r.source}</strong>
              <span>{r.fetched ?? 0} fetched</span>
              <span>{r.upserted ?? 0} upserted</span>
              <span style={{ color: r.success ? "#065f46" : "#b42318", fontWeight: 700 }}>
                {r.success ? "ok" : r.error ?? "fail"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </form>
  );
}
