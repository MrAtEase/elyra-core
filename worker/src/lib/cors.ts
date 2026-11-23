const ALLOW_HEADERS =
  "Content-Type, Authorization, X-Requested-With, x-internal-api-key, x-internal-timestamp, x-internal-nonce, x-internal-signature";

export function isAssistantPath(pathname: string): boolean {
  return pathname.startsWith("/assistant/");
}

function getAllowedOrigins(env: any): string[] {
  const configured = [
    env?.NEXT_ALLOWED_ORIGINS,
    env?.NEXT_ALLOWED_ORIGIN,
    env?.DASHBOARD_URL,
    env?.PUBLIC_APP_ORIGIN,
    env?.PUBLIC_WEB_ORIGIN,
  ]
    .filter(Boolean)
    .flatMap((v) => v.toString().split(",").map((s: string) => s.trim()))
    .filter((s) => s.length > 0);

  // Development fallback
  if (configured.length === 0 && env?.ENVIRONMENT !== "production") {
    return ["http://localhost:3000", "http://127.0.0.1:3000"];
  }

  return configured.length > 0 ? configured : [];
}

export function withCors(req: Request, res: Response, env: any): Response {
  const origin = req.headers.get("origin");
  const allowed = getAllowedOrigins(env);
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0];

  const out = new Response(res.body, res);
  if (allowOrigin) {
    out.headers.set("Access-Control-Allow-Origin", allowOrigin);
  }
  out.headers.set("Access-Control-Allow-Credentials", "true");
  out.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  out.headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
  out.headers.set("Vary", "Origin");
  return out;
}

export function preflightIfNeeded(req: Request, env: any): Response | null {
  if (req.method === "OPTIONS") {
    return withCors(req, new Response(null, { status: 204 }), env);
  }
  return null;
}
