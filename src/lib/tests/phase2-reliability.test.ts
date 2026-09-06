import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { rateLimitAsync } from "../api/rateLimit.js";
import { validateWebhookTimestamp } from "../alerts/service.js";
import { safeUploadName, sanitizePathSegments, validateFileSignature } from "../uploads/security.js";

const root = path.resolve(__dirname, "..", "..", "..");

async function main() {
  assert.equal(safeUploadName("../../invoice.exe", "application/pdf"), "invoice.pdf");
  const safeName = safeUploadName("résumé photo.PNG", "image/png");
  assert.match(safeName, /\.png$/);
  assert.doesNotMatch(safeName, /[\\/]/);
  assert.equal(sanitizePathSegments("../../school-assets\\2026/term 1", 3), "school-assets/2026/term1");

const png = new File([
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
], "photo.png", { type: "image/png" });
const fakePng = new File(["not an image"], "photo.png", { type: "image/png" });
const allowedImages = new Set(["image/png"]);
  assert.equal(await validateFileSignature(png, allowedImages), null);
  assert.match((await validateFileSignature(fakePng, allowedImages)) ?? "", /contents do not match/i);

const nowSeconds = String(Math.floor(Date.now() / 1000));
  assert.equal(validateWebhookTimestamp(new Request("https://example.test", { headers: { "x-webhook-timestamp": nowSeconds } })).ok, true);
  assert.equal(validateWebhookTimestamp(new Request("https://example.test", { headers: { "x-webhook-timestamp": "1" } })).ok, false);
  assert.equal(validateWebhookTimestamp(new Request("https://example.test")).ok, true);

const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const fallback = await rateLimitAsync({ name: "client-error", key: `phase2-test-${Date.now()}`, max: 1, windowMs: 60_000 });
  assert.equal(fallback.allowed, true);
  if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
  if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;

  const storageRoute = fs.readFileSync(path.join(root, "src", "app", "api", "storage", "upload", "route.ts"), "utf8");
  const photosRoute = fs.readFileSync(path.join(root, "src", "app", "api", "photos", "upload", "route.ts"), "utf8");
  const smsRoute = fs.readFileSync(path.join(root, "src", "app", "api", "sms-webhook", "route.ts"), "utf8");
  const emailRoute = fs.readFileSync(path.join(root, "src", "app", "api", "email-webhook", "route.ts"), "utf8");
  for (const source of [storageRoute, photosRoute]) {
    assert.match(source, /validateFileSignature/);
    assert.match(source, /requestSizeExceeds/);
  }
  for (const source of [smsRoute, emailRoute]) {
    assert.match(source, /validateWebhookTimestamp/);
    assert.match(source, /verify(?:Sms|Email)Secret/);
  }

  console.log("Phase 2 reliability contract checks passed.");
}

void main();
