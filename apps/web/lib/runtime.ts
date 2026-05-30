export function redactSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export function logEvent(event: string, payload: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "info", event, ...payload }));
}

export function logError(event: string, error: unknown, payload: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : "unknown_error";
  console.error(JSON.stringify({ level: "error", event, message, ...payload }));
}

export function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
