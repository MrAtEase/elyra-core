"use client";

import Link from "next/link";
import { Orb } from "@/components/Orb";

const PROOF_POINTS = [
  "Built in Europe",
  "Workspace separation (Personal - Team - System)",
  "Visible execution (Plan - Gather - Draft - Deliver)",
];

const EXECUTION_STEPS = [
  "Analyze local target audience",
  "Generate campaign concept",
  "Create 10 social posts",
  "Generate 3 image concepts",
  "Build a 12-slide deck",
  "Estimate ROI simulation",
  "Prepare calendar + tasks",
];

export default function HomePage() {
  return (
    <div className="bg-[#0b0f18] text-white">
      <section className="relative overflow-hidden px-6 py-20 sm:py-24 lg:py-32">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(59,130,246,0.08) 0%, transparent 70%)",
          }}
        />

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-20">
          <div className="scale-[1.5] sm:scale-[1.7] lg:scale-[1.85] blur-[0.3px]">
            <Orb />
          </div>
        </div>

        <div className="relative z-10 mx-auto max-w-5xl text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-white/45">Built in Europe AI Operating System</p>
          <h1 className="mt-5 text-4xl font-medium tracking-tight text-white sm:text-5xl lg:text-6xl">
            An AI Operating System
            <br />
            for real work.
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-relaxed text-white/65 sm:text-lg">
            Turn email, calendar, tasks and documents into one intent-driven workflow,
            with visible execution steps and approvals where it matters.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signin"
              className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-[#0b0f18] transition hover:bg-white/92"
            >
              Request early access
            </Link>
            <Link
              href="/how-it-works"
              className="rounded-md border border-white/15 px-5 py-2.5 text-sm text-white/88 transition hover:border-white/25 hover:text-white"
            >
              Watch a demo
            </Link>
          </div>

          <ul className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-white/60 sm:grid-cols-3 sm:gap-3 sm:text-sm">
            {PROOF_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 pb-16 sm:pb-20">
        <div className="mx-auto grid w-full max-w-5xl gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-white/8 bg-white/[0.03] p-6">
            <p className="text-xs uppercase tracking-[0.16em] text-white/35">For operators</p>
            <h2 className="mt-3 text-2xl font-medium text-white/92">Operate with one brain.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/62">
              Campaigns, reporting, hiring and launch planning powered by integrations and intent-driven execution.
            </p>
          </article>

          <article className="rounded-2xl border border-white/8 bg-white/[0.03] p-6">
            <p className="text-xs uppercase tracking-[0.16em] text-white/35">For investors</p>
            <h2 className="mt-3 text-2xl font-medium text-white/92">An OS-level platform.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/62">
              Elyra combines workspace infrastructure, policy controls, and a marketplace for integrations, workflows, and themes.
            </p>
          </article>
        </div>
      </section>

      <section className="border-y border-white/6 px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs uppercase tracking-[0.16em] text-white/35">What Elyra does</p>
          <h2 className="mt-4 text-3xl font-medium tracking-tight text-white/95 sm:text-4xl">
            One interface for everything you run.
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/62">
            Elyra connects email, calendar, tasks, files and external tools, then turns intent into a real execution plan.
            You do not just get an answer, you see the work.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-sm text-white/82">Not another chat app.</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-sm text-white/82">Not a single-purpose agent.</p>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-sm text-white/82">Not a dashboard with AI on top.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 sm:py-20">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/35">Ely in Action</p>
            <h2 className="mt-4 text-3xl font-medium tracking-tight text-white/95 sm:text-4xl">
              From intent to execution, step by step.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/62">
              Example intent: Create a launch plan for a new location in Costa da Caparica.
            </p>
            <p className="mt-3 text-base leading-relaxed text-white/62">
              Output: campaign package, slide deck, content plan, task list and calendar blocks.
            </p>
          </div>

          <ol className="space-y-2 rounded-2xl border border-white/8 bg-white/[0.03] p-5">
            {EXECUTION_STEPS.map((step, idx) => (
              <li key={step} className="flex items-start gap-3 border-b border-white/6 pb-2 text-sm text-white/72 last:border-b-0 last:pb-0">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[11px] text-white/65">
                  {idx + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-white/6 px-6 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-xs uppercase tracking-[0.16em] text-white/35">Platform</p>
          <h2 className="mt-4 text-3xl font-medium tracking-tight text-white/95 sm:text-4xl">
            Marketplace for integrations, workflows, and themes.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-relaxed text-white/62">
            Built for personal and business workspaces with strict boundaries, controlled cross-workspace flows,
            and transparent policies.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signin"
              className="rounded-md bg-white px-5 py-2.5 text-sm font-medium text-[#0b0f18] transition hover:bg-white/92"
            >
              Request early access
            </Link>
            <Link
              href="/solutions"
              className="rounded-md border border-white/15 px-5 py-2.5 text-sm text-white/88 transition hover:border-white/25 hover:text-white"
            >
              Partner with us
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
