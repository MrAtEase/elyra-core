"use client";

import Link from "next/link";

export default function OsCalendarConnectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6" style={{ background: "var(--app-bg, var(--bg-canvas))" }}>
      <div className="w-full max-w-[640px] rounded-[28px] border px-6 py-6 backdrop-blur-xl" style={{ borderColor: "rgba(248,113,113,0.35)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200/80">Calendar Integration</p>
        <h1 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">Unable to open iCloud connect</h1>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)]">
          {error.message || "The iCloud connect flow failed before the form could load."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-2xl px-4 py-2.5 text-sm font-medium"
            style={{ background: "var(--os-accent)", color: "var(--text-on-accent, #fff)" }}
          >
            Retry
          </button>
          <Link
            href="/os/calendar"
            className="rounded-2xl border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-secondary)" }}
          >
            Back to Calendar
          </Link>
        </div>
      </div>
    </main>
  );
}
