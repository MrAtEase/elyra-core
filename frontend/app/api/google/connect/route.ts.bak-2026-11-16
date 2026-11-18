import { NextRequest, NextResponse } from "next/server";
import { getGoogleAuthContext } from "@/lib/google/auth";
import {
  getGoogleServerEnvSafe,
  pickGoogleRedirectUri,
} from "@/lib/google/env";
import {
  createOAuthState,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google/oauthState";
import { GOOGLE_REQUIRED_DEMO_SCOPES, parseScopeString, serializeScopes } from "@/lib/google/scopes";
import { safeNext } from "@/lib/safeNext";
import { getWorkspaceId } from "@/lib/api/workspaceRequest";

export const runtime = "nodejs";

function redirectWithError(
  request: NextRequest,
  nextPath: string,
  message: string
): NextResponse {
  const target = new URL(nextPath, request.nextUrl.origin);
  target.searchParams.set("google_error", message);
  return NextResponse.redirect(target);
}

function isLocalOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function localSigninFallback(nextPath: string): string {
  return `/signin?reason=worker_auth_required&next=${encodeURIComponent(nextPath)}`;
}

function resolveReturnOrigin(request: NextRequest): string {
  const fromQuery = request.nextUrl.searchParams.get("return_origin")?.trim() ?? "";
  if (fromQuery) {
    try {
      const parsed = new URL(fromQuery);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      // ignore invalid query origin
    }
  }
  return request.nextUrl.origin;
}

function buildGoogleConnectResponse(input: {
  request: NextRequest;
  nextPath: string;
  workspaceId: string | null;
  requestedScopes?: string[];
  accessToken?: string;
  asJson: boolean;
}): Promise<NextResponse> {
  const { request, nextPath, workspaceId, requestedScopes, accessToken, asJson } = input;
  const envStatus = getGoogleServerEnvSafe();
  if (!envStatus.ok) {
    return Promise.resolve(
      asJson
        ? NextResponse.json(
            {
              ok: false,
              error: envStatus.error.issues.join(" | "),
            },
            { status: 400 }
          )
        : redirectWithError(request, nextPath, envStatus.error.issues.join(" | "))
    );
  }

  const authOptions = accessToken ? { accessToken } : undefined;
  return getGoogleAuthContext(request, workspaceId, authOptions).then((auth) => {
    if (!auth.ok) {
      if (asJson) {
        const safeLoginUrl = isLocalOrigin(request.nextUrl.origin)
          ? localSigninFallback(nextPath)
          : auth.loginUrl ?? "/signin";
        return NextResponse.json(
          {
            ok: false,
            error: auth.message,
            loginUrl: safeLoginUrl,
          },
          { status: auth.status }
        );
      }
      const safeRedirect = isLocalOrigin(request.nextUrl.origin)
        ? localSigninFallback(nextPath)
        : auth.loginUrl || localSigninFallback(nextPath);
      return NextResponse.redirect(
        new URL(
          safeRedirect,
          request.nextUrl.origin
        )
      );
    }

    const redirectUri = pickGoogleRedirectUri(envStatus.env, request.nextUrl.origin);
    const oauthState = createOAuthState({
      workspaceId: auth.context.workspaceId,
      userId: auth.context.userId,
      ...(accessToken ? { accessToken } : {}),
      next: nextPath,
      returnOrigin: resolveReturnOrigin(request),
      redirectUri,
      key: envStatus.env.TOKEN_ENCRYPTION_KEY_BYTES,
    });

    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", envStatus.env.GOOGLE_CLIENT_ID);
    googleUrl.searchParams.set("redirect_uri", redirectUri);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("access_type", "offline");
    // Force account picker so each workspace can connect a different Google account.
    googleUrl.searchParams.set("prompt", "consent select_account");
    googleUrl.searchParams.set("include_granted_scopes", "true");
    if (auth.context.email) {
      googleUrl.searchParams.set("login_hint", auth.context.email);
    }
    googleUrl.searchParams.set(
      "scope",
      serializeScopes([...(requestedScopes ?? []), ...GOOGLE_REQUIRED_DEMO_SCOPES])
    );
    googleUrl.searchParams.set("state", oauthState.state);

    const response = asJson
      ? NextResponse.json({ ok: true, url: googleUrl.toString() })
      : NextResponse.redirect(googleUrl);
    response.cookies.set({
      name: GOOGLE_OAUTH_STATE_COOKIE,
      value: oauthState.cookieValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: oauthState.maxAgeSeconds,
    });
    return response;
  });
}

export async function GET(request: NextRequest) {
  const nextPath = safeNext(request.nextUrl.searchParams.get("next"), "/os");
  const resolved = getWorkspaceId(request, false);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.error, reason: resolved.reason, hint: resolved.hint },
      { status: resolved.status }
    );
  }
  const requestedWorkspaceId = resolved.workspaceId;
  const requestedScopes = parseScopeString(request.nextUrl.searchParams.get("scopes"));
  return buildGoogleConnectResponse({
    request,
    nextPath,
    workspaceId: requestedWorkspaceId,
    requestedScopes,
    asJson: false,
  });
}

export async function POST(request: NextRequest) {
  const nextPath = safeNext(request.nextUrl.searchParams.get("next"), "/os");
  const resolved = getWorkspaceId(request, false);
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.error, reason: resolved.reason, hint: resolved.hint },
      { status: resolved.status }
    );
  }
  const requestedWorkspaceId = resolved.workspaceId;
  const body = (await request.json().catch(() => null)) as { scopes?: string[] | string } | null;
  const requestedScopes = Array.isArray(body?.scopes)
    ? body?.scopes
    : parseScopeString(typeof body?.scopes === "string" ? body.scopes : request.nextUrl.searchParams.get("scopes"));
  const authorization = request.headers.get("authorization");
  const accessToken =
    authorization && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : undefined;
  return buildGoogleConnectResponse({
    request,
    nextPath,
    workspaceId: requestedWorkspaceId,
    requestedScopes,
    ...(accessToken ? { accessToken } : {}),
    asJson: true,
  });
}
