import { NextResponse } from "next/server";
import { ensureEmailIoHealthLogged } from "@/lib/emailIoHealth";

const shouldAutoLogHealth =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PHASE !== "phase-production-build" &&
  process.env.EMAIL_IO_HEALTH_AUTO !== "0";

if (shouldAutoLogHealth) {
  void ensureEmailIoHealthLogged();
}

export type EmailIoApiErrorContext = {
  route: string;
  workspaceId: string;
  error: unknown;
};

export function handleEmailIoApiError(context: EmailIoApiErrorContext) {
  const { route, workspaceId, error } = context;
  const status = (error as any)?.status ?? 502;
  const responseBody = (error as any)?.responseBody ?? null;
  const upstreamUrl = (error as any)?.upstreamUrl ?? null;
  const message = error instanceof Error ? error.message : "Email I/O request failed";
  const logPayload = { workspaceId, upstreamUrl, status, message, route, responseBody };
  let parsedBody: Record<string, unknown> | null = null;
  if (typeof responseBody === "string" && responseBody.trim()) {
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed && typeof parsed === "object") {
        parsedBody = parsed as Record<string, unknown>;
      }
    } catch {
      parsedBody = null;
    }
  }
  const upstreamErrorCode =
    typeof parsedBody?.error === "string" ? parsedBody.error : null;
  const routeMissingMessage = [message, responseBody]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .find((value) => /Route\s+[A-Z]+:\/caldav\/(?:test|credentials)\s+not found/i.test(value));

  if (routeMissingMessage) {
    console.error(`[api:${route}] caldav routes missing upstream`, logPayload);
    return NextResponse.json(
      {
        error: "caldav_routes_missing",
        message:
          "This Calendar backend does not support iCloud CalDAV yet.",
        details:
          "The connected email-io service is missing /caldav/test and /caldav/credentials. Update or redeploy email-io with CalDAV routes enabled.",
        workspaceId,
        upstreamUrl,
      },
      { status: 503 }
    );
  }

  if (
    message.includes("EMAIL_IO_BASE_URL") ||
    message.includes("INTERNAL_API_KEY") ||
    message.includes("INTERNAL_API_SECRET")
  ) {
    console.error(`[api:${route}] email I/O not configured`, logPayload);
    return NextResponse.json(
      {
        error: "email_io_not_configured",
        message: "Calendar backend is not configured.",
        details:
          "Set EMAIL_IO_BASE_URL, INTERNAL_API_KEY, and INTERNAL_API_SECRET for the frontend runtime.",
        workspaceId,
        upstreamUrl,
      },
      { status: 503 }
    );
  }

  if (status === 401 || status === 403) {
    // Distinguish worker session/auth issues from IMAP/provider auth issues.
    if (upstreamErrorCode === "ICLOUD_AUTH_FAILED") {
      console.warn(`[api:${route}] icloud auth failed`, logPayload);
      return NextResponse.json(
        {
          error: "imap_auth_failed",
          message: "iCloud authentication failed. Verify email + app-specific password.",
          workspaceId,
          upstreamUrl,
        },
        { status: 401 }
      );
    }
    if (upstreamErrorCode === "UNAUTHORIZED") {
      console.error(`[api:${route}] internal email-io auth mismatch`, logPayload);
      return NextResponse.json(
        {
          error: "email_io_auth_mismatch",
          message:
            "email-io internal auth mismatch. Check INTERNAL_API_KEY/INTERNAL_API_SECRET in frontend and email-io.",
          workspaceId,
          upstreamUrl,
        },
        { status: 503 }
      );
    }
    console.error(`[api:${route}] unauthorized`, logPayload);
    return NextResponse.json(
      {
        error: "worker_session_missing",
        message: `Worker session missing or not authorized for workspaceId=${workspaceId}`,
        workspaceId,
        upstreamUrl,
      },
      { status: 401 }
    );
  }

  if (status === 503) {
    console.error(`[api:${route}] email I/O unavailable`, logPayload);
    return NextResponse.json(
      {
        error: "email_io_unavailable",
        message,
        workspaceId,
        upstreamUrl,
      },
      { status: 503 }
    );
  }

  const finalStatus = status >= 400 ? status : 502;
  if (finalStatus >= 500) {
    console.error(`[api:${route}] upstream error`, logPayload);
  } else {
    console.warn(`[api:${route}] downstream error`, logPayload);
  }

  return NextResponse.json(
    { error: message, workspaceId, upstreamUrl },
    { status: finalStatus }
  );
}
