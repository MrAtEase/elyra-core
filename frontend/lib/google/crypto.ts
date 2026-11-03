import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENCRYPTION_PREFIX = "enc:v1";
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function toBase64Url(input: Buffer): string {
  return input.toString("base64url");
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function assertKeyLength(key: Buffer): void {
  if (key.byteLength !== 32) {
    throw new Error("Invalid encryption key length. Expected 32 bytes.");
  }
}

export function encryptGoogleSecret(plainText: string, key: Buffer): string {
  assertKeyLength(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}:${toBase64Url(iv)}:${toBase64Url(authTag)}:${toBase64Url(encrypted)}`;
}

export function decryptGoogleSecret(cipherText: string | null, key: Buffer): string | null {
  if (!cipherText) return null;
  assertKeyLength(key);

  if (!cipherText.startsWith(`${ENCRYPTION_PREFIX}:`)) {
    // Backward compatible with legacy plain-text rows.
    return cipherText;
  }

  const parts = cipherText.split(":");
  if (parts.length !== 5) {
    throw new Error("Invalid encrypted token format.");
  }

  const iv = fromBase64Url(parts[2]!);
  const authTag = fromBase64Url(parts[3]!);
  const encrypted = fromBase64Url(parts[4]!);

  try {
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    // Token was encrypted with a different key/workspace binding or corrupted.
    // Return null so reconnect flow can overwrite it with fresh credentials.
    return null;
  }
}
