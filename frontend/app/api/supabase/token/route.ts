import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getWhoamiEndpoint } from "@/utils/auth-guard";
import type { WhoamiResponse } from "@/types/whoami";

const JWT_EXPIRATION_SECONDS = 20 * 60;
const JWT_AUDIENCE = "authenticated";
const JWT_ISSUER = "supabase";

type SupabaseTokenPayload = {
  sub: string;
  role: string;
  aud: string;
  iss: string;
  iat: number;
  exp: number;
  email: string | null;
};

function base64UrlEncode(payload: string) {
  return Buffer.from(payload)
    .toString("base64url")
    .replace(/=+$/, "");
}

function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string
) {
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

function buildPayload(userId: string, email: string | null): SupabaseTokenPayload {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    sub: userId,
    role: "authenticated",
    aud: JWT_AUDIENCE,
    iss: JWT_ISSUER,
    iat: nowSeconds,
    exp: nowSeconds + JWT_EXPIRATION_SECONDS,
    email,
  };
}

function parseUserId(whoami: WhoamiResponse) {
  return whoami.user?.id || whoami.userId || whoami.userKey;
}

function resolveWorkerCookieHeader(request: NextRequest): string | null {
  const provided = request.headers.get("cookie");
  if (provided && provided.trim()) {
    return provided;
  }
  const sessionCookie = request.cookies.get("mf-s");
  if (sessionCookie?.value) {
    return `mf-s=${sessionCookie.value}`;
  }
  return null;
}

async function fetchWhoami(cookieHeader: string | null) {
  const headers = new Headers();
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }
  const response = await fetch(getWhoamiEndpoint(), {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  return { response, payload } as {
    response: Response;
    payload: WhoamiResponse | null;
  };
}

export async function POST(request: NextRequest) {
  const { response: whoamiResponse, payload: whoamiPayload } = await fetchWhoami(
    resolveWorkerCookieHeader(request)
  );

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json(
      { error: "Missing SUPABASE_JWT_SECRET" },
      { status: 500 }
    );
  }

  if (!whoamiResponse.ok || !whoamiPayload) {
    return NextResponse.json(
      { error: "Unable to validate session" },
      { status: whoamiResponse.status }
    );
  }

  const userId = parseUserId(whoamiPayload);
  if (!userId) {
    return NextResponse.json({ error: "Invalid whoami response" }, { status: 500 });
  }

  const payload = buildPayload(userId, whoamiPayload.user?.email ?? null);
  const token = signJwt({ alg: "HS256", typ: "JWT" }, payload, jwtSecret);

  return NextResponse.json({
    access_token: token,
    expires_at: payload.exp * 1000,
    expires_in: JWT_EXPIRATION_SECONDS,
  });
}
