const DEFAULT_MAX_BYTES = 256 * 1024;

export const PASSKEY_AUTHENTICATION_OPTIONS_MAX_BYTES = 2 * 1024;
export const PASSKEY_AUTHENTICATION_VERIFY_MAX_BYTES = 32 * 1024;

export async function readLimitedJsonObject(
  request: Request,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Record<string, unknown> | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return null;
  const rawLength = request.headers.get("content-length");
  if (rawLength) {
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      return null;
    }
  }
  if (!request.body) return {};

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    return (
      parsed !== null
      && typeof parsed === "object"
      && !Array.isArray(parsed)
    )
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
