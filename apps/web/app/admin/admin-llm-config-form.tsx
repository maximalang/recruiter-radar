"use client";

import { useActionState, useState } from "react";
import { saveLlmConfig, clearLlmConfig } from "./admin-actions";

/**
 * Operator LLM-provider config form. Lets the operator switch the LLM provider
 * (API key + base URL + model) at runtime — no redeploy, no env edit.
 *
 * Each row is its own save/clear pair so one field can be changed without
 * re-entering the others. The API-key field is masked when a key is stored
 * (••••xxxx); editing it requires typing a full new key — a masked placeholder
 * is rejected server-side so the stored key is never overwritten with mask dots.
 *
 * Auth + secret handling live in the server actions (saveLlmConfig /
 * clearLlmConfig) and lib/operatorSettings.ts; this component only renders and
 * submits. No secret value is ever sent back to the client — only the masked
 * display form.
 */

export interface LlmSettingView {
  key: string;
  value: string;
  isSecret: boolean;
  isSet: boolean;
  updatedAt: string;
}

const LABELS: Record<string, string> = {
  llm_api_key: "API-ключ",
  llm_base_url: "Base URL",
  llm_model: "Модель",
};

const PLACEHOLDERS: Record<string, string> = {
  llm_api_key: "sk-… или ключ провайдера",
  llm_base_url: "https://api.openai.com/v1",
  llm_model: "gpt-4o-mini / codexoid/kr/claude-opus-4.8",
};

function Row({ setting }: { setting: LlmSettingView }) {
  const [value, setValue] = useState("");
  const [saveState, saveAction, savePending] = useActionState(saveLlmConfig, { ok: false, message: "" });
  const [clearState, clearAction, clearPending] = useActionState(clearLlmConfig, { ok: false, message: "" });
  const label = LABELS[setting.key] ?? setting.key;
  const placeholder = PLACEHOLDERS[setting.key] ?? "";

  return (
    <div
      style={{
        display: "grid",
        gap: "8px",
        padding: "12px",
        border: "1px solid var(--color-separator)",
        borderRadius: "12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{label}</div>
          <div style={{ fontSize: "0.74rem", color: "var(--color-text-tertiary)" }}>
            <code>{setting.key}</code> · {setting.isSet ? `сохранено${setting.isSecret ? `: ${setting.value}` : `: ${setting.value}`}` : "не задано (env по умолчанию)"}
          </div>
        </div>
        {setting.isSet && (
          <form action={clearAction}>
            <input type="hidden" name="key" value={setting.key} />
            <button
              type="submit"
              disabled={clearPending}
              style={{
                background: "transparent",
                color: "var(--color-text-tertiary)",
                border: "1px solid var(--color-separator)",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "0.8rem",
                cursor: clearPending ? "wait" : "pointer",
              }}
            >
              {clearPending ? "Сброс…" : "Сбросить → env"}
            </button>
          </form>
        )}
      </div>

      <form action={saveAction} style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="key" value={setting.key} />
        <input
          name="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1,
            minWidth: "220px",
            fontSize: "var(--type-body-size)",
            padding: "8px 12px",
            border: "1px solid var(--color-separator)",
            borderRadius: "10px",
            fontFamily: setting.isSecret ? "monospace" : undefined,
          }}
        />
        <button
          type="submit"
          disabled={savePending || value.trim() === ""}
          style={{
            background: "var(--color-signal)",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: "10px",
            fontWeight: 600,
            fontSize: "var(--type-body-size)",
            border: "none",
            cursor: savePending ? "wait" : "pointer",
            opacity: savePending || value.trim() === "" ? 0.6 : 1,
          }}
        >
          {savePending ? "Сохранение…" : "Сохранить"}
        </button>
      </form>

      {(saveState.message || clearState.message) && (
        <div
          style={{
            fontSize: "0.8rem",
            padding: "8px 10px",
            borderRadius: "8px",
            background: (saveState.ok || clearState.ok) ? "#d1fae5" : "#fee4e2",
            color: (saveState.ok || clearState.ok) ? "#065f46" : "#b42318",
          }}
        >
          {saveState.message || clearState.message}
        </div>
      )}
    </div>
  );
}

export default function AdminLlmConfigForm({ settings }: { settings: LlmSettingView[] }) {
  return (
    <div style={{ display: "grid", gap: "10px" }}>
      {settings.map((s) => (
        <Row key={s.key} setting={s} />
      ))}
      <p style={{ fontSize: "0.76rem", color: "var(--color-text-tertiary)", margin: 0 }}>
        Приоритет: значение из панели → env (OPENAI_API_KEY / OPENAI_BASE_URL /
        CODEXOID_MODEL). Изменения вступают в силу сразу, без редеплоя. API-ключ
        хранится маскированно и не попадает в логи.
      </p>
    </div>
  );
}
