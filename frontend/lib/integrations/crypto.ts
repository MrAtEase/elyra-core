import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const VERSION = "v1";

function getSecretKey(): Buffer {
  const secret =
    process.env.INTEGRATIONS_SECRET ||
    process.env.EMAIL_IO_INTERNAL_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    process.env.ELYRA_INTERNAL_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("INTEGRATIONS_SECRET (or INTERNAL_API_SECRET) is required.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptIntegrationSecret(plainText: string): string {
  const key = getSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptIntegrationSecret(cipherText: string): string {
  const [version, ivB64, tagB64, dataB64] = cipherText.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted credential payload.");
  }
  const key = getSecretKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

