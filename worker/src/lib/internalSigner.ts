export type InternalSignerEnv = {
  INTERNAL_API_KEY: string;
  INTERNAL_API_SECRET: string;
};

const enc = new TextEncoder();

function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function hmacSha256Base64(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return base64FromArrayBuffer(sig);
}

function nonce(): string {
  return crypto.randomUUID();
}

/**
 * Canonical:
 * METHOD\nPATH_WITH_QUERY\nTIMESTAMP\nNONCE\nBODY_STRING
 */
export async function signInternalRequest(args: {
  env: InternalSignerEnv;
  method: string;
  pathWithQuery: string;
  bodyString: string; // "" for GET/HEAD
}): Promise<Record<string, string>> {
  const ts = Date.now().toString();
  const n = nonce();
  const canonical = `${args.method}\n${args.pathWithQuery}\n${ts}\n${n}\n${args.bodyString}`;
  const signature = await hmacSha256Base64(args.env.INTERNAL_API_SECRET, canonical);

  return {
    "x-internal-api-key": args.env.INTERNAL_API_KEY,
    "x-internal-timestamp": ts,
    "x-internal-nonce": n,
    "x-internal-signature": signature,
  };
}
