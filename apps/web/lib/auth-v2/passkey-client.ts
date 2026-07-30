import { WebAuthnError } from "@simplewebauthn/browser";

export function isPasskeyCeremonyCancellation(error: unknown): boolean {
  if (
    error instanceof WebAuthnError
    && error.code === "ERROR_CEREMONY_ABORTED"
  ) {
    return true;
  }
  return (
    error instanceof Error
    && (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}
