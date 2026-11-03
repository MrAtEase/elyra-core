import Link from "next/link";
import { redirect } from "next/navigation";

export default async function OsCalendarConnectCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawError = params.error;
  const error = Array.isArray(rawError) ? rawError[0] : rawError;

  if (!error) {
    redirect("/os/calendar?calendar_connect=icloud_success");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6" style={{ background: "var(--app-bg, var(--bg-canvas))" }}>
      <div className="w-full max-w-[640px] rounded-[28px] border px-6 py-6 backdrop-blur-xl" style={{ borderColor: "rgba(245,158,11,0.35)", background: "color-mix(in srgb, var(--bg-elevated) 94%, transparent)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/80">Calendar Integration</p>
        <h1 className="mt-2 text-2xl font-semibold text-[color:var(--text-primary)]">iCloud connect could not complete</h1>
        <p className="mt-2 text-sm text-[color:var(--text-secondary)]">{error}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/os/calendar"
            className="rounded-2xl px-4 py-2.5 text-sm font-medium"
            style={{ background: "var(--os-accent)", color: "var(--text-on-accent, #fff)" }}
          >
            Back to Calendar
          </Link>
          <Link
            href="/os/calendar/connect"
            className="rounded-2xl border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--os-border-soft)", background: "var(--bg-surface)", color: "var(--text-secondary)" }}
          >
            Retry Connect
          </Link>
        </div>
      </div>
    </main>
  );
}
