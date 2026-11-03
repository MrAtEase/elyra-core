import { createHmac } from "crypto";

export function deriveWorkspaceKey(masterKey: Buffer, workspaceId: string, keyVersion = "v1"): Buffer {
  const digest = createHmac("sha256", masterKey)
    .update(`workspace:${workspaceId}:version:${keyVersion}`)
    .digest();
  return Buffer.from(digest.subarray(0, 32));
}
