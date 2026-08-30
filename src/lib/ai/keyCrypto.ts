/**
 * Encrypt/decrypt a school's optional "bring your own API key"
 * override before it ever reaches Postgres.
 *
 * Why encryption happens here (Node), not in Postgres: the secret
 * that protects these keys (AI_KEY_ENCRYPTION_SECRET) lives only in
 * Vercel's server environment, same tier as SUPABASE_SERVICE_ROLE_KEY.
 * Postgres never sees it, so even a full DB dump or a misconfigured
 * RLS policy cannot recover a school's key — only this server process,
 * holding the Vercel-side secret, can decrypt org_ai_settings
 * .override_api_key_ciphertext.
 *
 * Algorithm: AES-256-GCM. The stored ciphertext packs
 * iv (12 bytes) + authTag (16 bytes) + ciphertext, all base64 in one
 * string, so the column stays a single opaque text value.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";

const ALGO = "aes-256-gcm";

function deriveKey(): Buffer {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "AI_KEY_ENCRYPTION_SECRET is not set. Required to store or read a " +
      "school's own AI provider API key. Add it in Vercel → Settings → " +
      "Environment Variables (type Secret) — any long random string works; " +
      "generate one with `openssl rand -hex 32`. Changing it after keys are " +
      "stored makes existing overrides undecryptable, so treat it like any " +
      "other production secret: set once, back up, never rotate casually."
    );
  }
  // SHA-256 of the raw secret gives us a stable 32-byte key regardless of
  // the secret's own length/format.
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypts a plaintext API key for storage in org_ai_settings.override_api_key_ciphertext. */
export function encryptProviderKey(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Decrypts a value previously produced by encryptProviderKey. Throws on tamper/corruption. */
export function decryptProviderKey(packed: string): string {
  const key = deriveKey();
  const buf = Buffer.from(packed, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
