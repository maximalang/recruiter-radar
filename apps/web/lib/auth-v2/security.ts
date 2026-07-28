import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import type { AuthEnvironment } from "./config";

const AUTH_PATHS = [
  "/account",
  "/checkout",
  "/dashboard",
  "/leads",
  "/onboarding",
  "/opportunities",
  "/profile",
  "/review",
  "/settings",
] as const;

const LOCAL_PART_PATTERN =
  /^[\p{L}\p{N}\p{M}!#$%&'*+/=?^_`{|}~.-]+$/u;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type NormalizedAuthEmail = {
  canonical: string;
  normalized: string;
};

export function normalizeAuthEmail(value: unknown): NormalizedAuthEmail | null {
  if (typeof value !== "string") return null;

  const email = value.normalize("NFC").trim();
  if (
    email.length === 0
    || /[\u0000-\u001f\u007f]/u.test(email)
    || /[,;]/u.test(email)
  ) {
    return null;
  }

  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;

  const local = email.slice(0, at);
  const rawDomain = email.slice(at + 1);
  if (
    Buffer.byteLength(local, "utf8") > 64
    || local.startsWith(".")
    || local.endsWith(".")
    || local.includes("..")
    || !LOCAL_PART_PATTERN.test(local)
  ) {
    return null;
  }

  const domain = domainToASCII(rawDomain).toLowerCase();
  const labels = domain.split(".");
  if (
    !domain
    || domain.length > 253
    || labels.length < 2
    || labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))
  ) {
    return null;
  }

  const canonical = `${local}@${domain}`;
  if (Buffer.byteLength(canonical, "utf8") > 254) return null;

  return { canonical, normalized: canonical };
}

export function sanitizeAuthReturnTo(value: unknown): string {
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return "/dashboard";
  }

  try {
    const parsed = new URL(value, "https://account.invalid");
    if (parsed.origin !== "https://account.invalid") return "/dashboard";

    const allowed = AUTH_PATHS.some(
      (path) => parsed.pathname === path || parsed.pathname.startsWith(`${path}/`),
    );
    return allowed
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

type AuthClientAddressInput = {
  directAddress: string | null | undefined;
  headers: Pick<Headers, "get">;
  env?: AuthEnvironment;
};

function validAddress(value: string | null | undefined): string | null {
  const address = value?.trim() ?? "";
  return isIP(address) > 0 ? address : null;
}

export function resolveAuthClientAddress({
  directAddress,
  headers,
  env = process.env,
}: AuthClientAddressInput): string {
  const direct = validAddress(directAddress) ?? "unknown";
  const configuredHeader = env.AUTH_TRUSTED_PROXY_HEADER;

  if (configuredHeader === "cf-connecting-ip" || configuredHeader === "x-real-ip") {
    return validAddress(headers.get(configuredHeader)) ?? direct;
  }

  if (configuredHeader !== "x-forwarded-for") return direct;
  if (!/^[1-9]\d*$/.test(env.AUTH_TRUSTED_PROXY_HOPS ?? "")) return direct;

  const trustedHops = Number(env.AUTH_TRUSTED_PROXY_HOPS);
  if (!Number.isSafeInteger(trustedHops) || trustedHops > 10) return direct;

  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => validAddress(entry));
  if (
    chain.length < trustedHops
    || chain.some((address) => address === null)
  ) {
    return direct;
  }

  return chain[chain.length - trustedHops] ?? direct;
}
