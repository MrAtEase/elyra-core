import { Suspense } from "react";

function SignInFallback() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Workspace</p>
            <h1 className="text-2xl font-semibold tracking-tight">Anmelden</h1>
            <p className="text-sm text-slate-400">Loading...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<SignInFallback />}>
      {children}
    </Suspense>
  );
}
