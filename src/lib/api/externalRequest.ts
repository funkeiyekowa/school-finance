import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";

const DEFAULT_ALLOWED_PORTS = new Set(["", "443", "8443"]);
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export class ExternalRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalRequestError";
  }
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return false;
  if (/^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) {
    return false;
  }
  if (normalized.startsWith("2001:db8:")) return false;

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPublicIpv4(mappedIpv4) : true;
}

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address.split("%")[0]);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

export function parseExternalHttpsUrl(value: unknown): URL {
  if (typeof value !== "string" || !value.trim()) {
    throw new ExternalRequestError("A gateway URL is required.");
  }

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new ExternalRequestError("The gateway URL is invalid.");
  }

  if (url.protocol !== "https:") {
    throw new ExternalRequestError("Gateway connections must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new ExternalRequestError("Credentials must not be embedded in the gateway URL.");
  }
  if (!DEFAULT_ALLOWED_PORTS.has(url.port)) {
    throw new ExternalRequestError("The gateway URL uses a port that is not allowed.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".lan")
  ) {
    throw new ExternalRequestError("Private network gateway addresses are not allowed.");
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new ExternalRequestError("Private or reserved gateway addresses are not allowed.");
  }

  url.hostname = hostname;
  url.hash = "";
  return url;
}

export async function validateExternalHttpsUrl(value: unknown): Promise<URL> {
  const url = parseExternalHttpsUrl(value);
  if (isIP(url.hostname)) return url;

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ExternalRequestError("The gateway hostname could not be resolved.");
  }

  if (addresses.length === 0 || addresses.some(result => !isPublicIpAddress(result.address))) {
    throw new ExternalRequestError("The gateway hostname resolves to a private or reserved address.");
  }
  return url;
}

export async function fetchExternalHttps(
  value: unknown,
  init: Omit<RequestInit, "redirect" | "signal">,
): Promise<Response> {
  const url = await validateExternalHttpsUrl(value);
  return fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new ExternalRequestError("The gateway response was too large.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ExternalRequestError("The gateway response was too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function readExternalJson<T>(response: Response): Promise<T> {
  const text = await readLimitedBody(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ExternalRequestError("The gateway returned an invalid response.");
  }
}
