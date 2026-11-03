"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

function ShellCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      className="w-full max-w-[640px] rounded-[28px] border px-6 py-6 shadow-[0_24px_64px_rgba(5,9,18,0.42)] backdrop-blur-xl"
      style={{ borderColor: "var(--os-border-soft)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-tertiary)]">GitHub Connector</p>
      <h1 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">{title}</h1>
      <p className="mt-2 text-sm text-[color:var(--text-secondary)]">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export default function OsGithubConnectPage() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId")?.trim() ?? "";
  const next = searchParams.get("next")?.trim() || `/os/code?workspaceId=${encodeURIComponent(workspaceId)}`;
  const githubError = searchParams.get("github_error")?.trim() ?? "";
  const [attemptedRedirect, setAttemptedRedirect] = useState(false);
  const oauthUrl = useMemo(
    () => `/api/github/connect?workspaceId=${encodeURIComponent(workspaceId)}&next=${encodeURIComponent(next)}`,
    [workspaceId, next],
  );

  useEffect(() => {
    if (!workspaceId || githubError || attemptedRedirect) return;
    setAttemptedRedirect(true);
    window.location.assign(oauthUrl);
  }, [attemptedRedirect, githubError, oauthUrl, workspaceId]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6" style={{ background: "var(--app-bg, var(--bg-canvas))" }}>
      <ShellCard
        title="Connect GitHub"
        subtitle="Authorize this workspace with GitHub OAuth so Elyra can use repository context in Code."
      >
        {!workspaceId ? (
          <div className="rounded-2xl border px-4 py-4 text-sm" style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(127,29,29,0.18)", color: "rgb(254,226,226)" }}>
            Missing `workspaceId` in the URL. Open this flow from the Connectors panel so the workspace context is preserved.
          </div>
        ) : null}

        {githubError ? (
          <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "rgba(245,158,11,0.35)", background: "rgba(120,53,15,0.18)", color: "var(--text-primary)" }}>
            <p>{githubError}</p>
            <p className="mt-1 text-xs text-[color:var(--text-secondary)]">
              Configure `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and a matching `GITHUB_REDIRECT_URI` (or `NEXT_PUBLIC_APP_URL`) if this is a server configuration issue.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-primary)" }}>
            Redirecting to GitHub authorization…
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href={oauthUrl}
            className="rounded-2xl px-4 py-2.5 text-sm font-medium transition"
            style={{ background: "var(--os-accent)", color: "white" }}
          >
            Continue with GitHub
          </a>
          <Link
            href={workspaceId ? `/os/code?workspaceId=${encodeURIComponent(workspaceId)}` : "/os/code"}
            className="rounded-2xl border px-4 py-2.5 text-sm font-medium transition"
            style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-primary)" }}
          >
            Back to Code
          </Link>
        </div>
      </ShellCard>
    </main>
  );
}
