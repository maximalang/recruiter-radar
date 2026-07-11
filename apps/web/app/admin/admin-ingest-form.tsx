"use client";

import { useState } from "react";

/**
 * Operator-only ingest trigger. Calls /api/sources/ingest with the operator
 * API key entered by the admin. The key is sent only to our own origin and is
 * NOT persisted — it lives in component state for the duration of the request.
 *
 * The /admin server page already gated on checkOperatorAccess(), so this form
 * only renders when an admin key is configured on the server. We still ask for
 * the key client-side because the server component render cannot forward the
 * header into a fetch from the browser; this keeps the key out of the DOM/HTML.
 */
export default function AdminIngestForm() {
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<"all" | "single">("all");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    setError(null);

    try {
      const body: Record<string, unknown> = {};
      if (mode === "single" && source.trim()) {
        body.source = source.trim();
      }
      // else: empty body → route defaults to ingestAllPrimarySources()

      const res = await fetch("/api/sources/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
      } else {
        setResult(JSON.stringify(data, null, 2));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Сеть/ошибка запроса");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "12px" }}>
      <label style={{ display: "grid", gap: "6px" }}>
        <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--c-text-secondary, #475569)" }}>
          Ключ оператора (ADMIN_API_KEY / INGEST_API_KEY)
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="rr-..."
          required
          autoComplete="off"
          style={{
            fontSize: "var(--fs-base)",
            padding: "10px 14px",
            border: "1px solid var(--c-border, #e2e8f0)",
            borderRadius: "10px",
            width: "100%",
          }}
        />
      </label>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "0.86rem" }}>
          <input type="radio" name="mode" checked={mode === "all"} onChange={() => setMode("all")} />
          Все primary
        </label>
        <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "0.86rem" }}>
          <input type="radio" name="mode" checked={mode === "single"} onChange={() => setMode("single")} />
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
        disabled={busy}
        style={{
          background: "var(--c-brand, #1d4ed8)",
          color: "#fff",
          padding: "12px 22px",
          borderRadius: "12px",
          fontWeight: 600,
          fontSize: "var(--fs-base)",
          border: "none",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.7 : 1,
          justifySelf: "start",
        }}
      >
        {busy ? "Запуск…" : "Запустить инжест"}
      </button>

      {error ? (
        <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#fee4e2", color: "#b42318", fontSize: "0.86rem" }}>
          {error}
        </div>
      ) : null}
      {result ? (
        <pre style={{ margin: 0, fontSize: "0.8rem", color: "var(--c-text-secondary, #475569)", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "rgba(241,245,249,0.6)", padding: "12px", borderRadius: "10px" }}>
          {result}
        </pre>
      ) : null}
    </form>
  );
}
