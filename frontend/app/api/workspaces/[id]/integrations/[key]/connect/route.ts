import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceAccessFromPath } from "@/app/api/workspaces/_utils";

function trimEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function mapIntegrationKey(value: string): "google_workspace" | "imap_smtp" | "github" | "figma" | "banana2" | "google_stitch" | "twentyfirst" | "unknown" {
  const key = value.toLowerCase();
  if (key === "google_workspace" || key === "google") return "google_workspace";
  if (key === "imap_smtp" || key === "imap" || key === "icloud_imap") return "imap_smtp";
  if (key === "github") return "github";
  if (key === "figma") return "figma";
  if (key === "banana2" || key === "banana") return "banana2";
  if (key === "google_stitch" || key === "stitch") return "google_stitch";
  if (key === "twentyfirst" || key === "21st" || key === "21st_dev" || key === "21st.dev") return "twentyfirst";
  return "unknown";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; key: string }> },
) {
  const { id, key } = await context.params;
  const auth = await requireWorkspaceAccessFromPath(request, id);
  if (!auth.ok) return auth.response;

  const integration = mapIntegrationKey(key);
  if (integration === "google_workspace") {
    const next = "/os";
    return NextResponse.json({
      ok: true,
      integrationKey: "google_workspace",
      connectUrl: `/api/google/connect?workspaceId=${encodeURIComponent(auth.workspaceId)}&next=${encodeURIComponent(next)}`,
    });
  }

  if (integration === "imap_smtp") {
    const payload = (await request.json().catch(() => null)) as
      | {
          credentials?: {
            email?: string;
            username?: string;
            appPassword?: string;
            smtpHost?: string;
            smtpPort?: number | null;
            smtpUsername?: string;
            smtpAppPassword?: string;
            smtpSecure?: boolean;
            imapHost?: string;
            imapPort?: number | null;
          };
        }
      | null;
    if (!payload?.credentials?.username || !payload.credentials.appPassword) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_credentials",
          hint: "Provide credentials.username and credentials.appPassword for IMAP setup.",
        },
        { status: 400 },
      );
    }

    const upstream = await fetch(new URL("/api/mail/imap/credentials", request.nextUrl.origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: JSON.stringify({
        workspaceId: auth.workspaceId,
        credentials: {
          email: payload.credentials.email ?? payload.credentials.username,
          username: payload.credentials.username,
          appPassword: payload.credentials.appPassword,
          smtpHost: payload.credentials.smtpHost,
          smtpPort: payload.credentials.smtpPort,
          smtpUsername: payload.credentials.smtpUsername ?? payload.credentials.username,
          smtpAppPassword: payload.credentials.smtpAppPassword ?? payload.credentials.appPassword,
          smtpSecure: payload.credentials.smtpSecure ?? true,
          imapHost: payload.credentials.imapHost,
          imapPort: payload.credentials.imapPort,
        },
      }),
      cache: "no-store",
    });
    const result = await upstream.json().catch(() => null);
    return NextResponse.json(result ?? { ok: upstream.ok }, { status: upstream.status });
  }

  if (integration === "github") {
    const next = `/os/code?workspaceId=${encodeURIComponent(auth.workspaceId)}`;
    const configuredConnectUrl = trimEnv("GITHUB_CONNECT_URL", "NEXT_PUBLIC_GITHUB_CONNECT_URL");
    const connectUrl = configuredConnectUrl
      ? `${configuredConnectUrl}${configuredConnectUrl.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(auth.workspaceId)}&next=${encodeURIComponent(next)}`
      : `/api/github/connect?workspaceId=${encodeURIComponent(auth.workspaceId)}&next=${encodeURIComponent(next)}`;

    return NextResponse.json({
      ok: true,
      integrationKey: "github",
      configured: true,
      connectUrl,
      hint:
        configuredConnectUrl.length > 0
          ? "GitHub connect is configured. Continue in the GitHub authorization flow."
          : "Continue with GitHub OAuth to authorize this workspace.",
    });
  }

  if (integration === "figma") {
    const configuredConnectUrl = trimEnv("FIGMA_CONNECT_URL", "NEXT_PUBLIC_FIGMA_CONNECT_URL");
    const connectUrl = configuredConnectUrl || "https://www.figma.com/settings";
    return NextResponse.json({
      ok: true,
      integrationKey: "figma",
      configured: true,
      connectUrl,
      hint:
        "Open Figma settings, ensure your account is authenticated, and enable Figma context for Elyra (MCP/Dev Mode) in your tooling setup.",
    });
  }

  if (integration === "banana2") {
    const configuredConnectUrl = trimEnv("BANANA2_CONNECT_URL", "NEXT_PUBLIC_BANANA2_CONNECT_URL");
    const connectUrl = configuredConnectUrl || "https://www.banana.dev/";
    return NextResponse.json({
      ok: true,
      integrationKey: "banana2",
      configured: true,
      connectUrl,
      hint:
        "Open Banana/Nano Banana provider settings and complete API setup. Configure BANANA2_API_KEY (or reuse GEMINI_API_KEY) for Elyra runtime usage.",
    });
  }

  if (integration === "google_stitch") {
    const configuredConnectUrl = trimEnv("GOOGLE_STITCH_CONNECT_URL", "NEXT_PUBLIC_GOOGLE_STITCH_CONNECT_URL");
    const connectUrl = configuredConnectUrl || "https://stitch.withgoogle.com/";
    return NextResponse.json({
      ok: true,
      integrationKey: "google_stitch",
      configured: true,
      connectUrl,
      hint:
        "Open Google Stitch, authenticate your Google account, then configure STITCH_API_KEY or GOOGLE_STITCH_API_KEY for Elyra runtime usage.",
    });
  }

  if (integration === "twentyfirst") {
    const configuredConnectUrl = trimEnv("TWENTYFIRST_CONNECT_URL", "NEXT_PUBLIC_TWENTYFIRST_CONNECT_URL");
    const connectUrl = configuredConnectUrl || "https://21st.dev/";
    return NextResponse.json({
      ok: true,
      integrationKey: "twentyfirst",
      configured: true,
      connectUrl,
      hint:
        "Open 21st.dev to browse/install UI assets and keep TWENTYFIRST_API_KEY configured so Elli can consume the asset library.",
    });
  }

  return NextResponse.json(
    { ok: false, error: "unsupported_integration_key", hint: `Unsupported integration key: ${key}` },
    { status: 400 },
  );
}
