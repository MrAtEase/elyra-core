import Link from "next/link";

const CAPABILITIES = [
  {
    title: "Workspace",
    desc: "A single pane of glass for your entire operation. Dashboards, KPIs, and system health at a glance.",
  },
  {
    title: "Email",
    desc: "Gmail and iCloud mail, unified. Read, compose, and triage without leaving your workspace.",
  },
  {
    title: "Calendar",
    desc: "Google Calendar integration with AI-assisted scheduling, conflict detection, and smart suggestions.",
  },
  {
    title: "Planner",
    desc: "Task management built for execution. Create, prioritize, and track work across your team.",
  },
  {
    title: "Build",
    desc: "Automations, workflows, and custom modules. Build internal tools directly inside Elyra Core.",
  },
  {
    title: "Marketplace",
    desc: "Discover and install community modules, integrations, and templates to extend your workspace.",
  },
];

const ARCHITECTURE = [
  {
    title: "Edge-First",
    desc: "API runs on Cloudflare Workers at 300+ locations worldwide. Sub-200ms response times.",
  },
  {
    title: "AI-Native",
    desc: "Context-aware copilot that understands your workspace, proposes actions, and executes with confirmation.",
  },
  {
    title: "Multi-Tenant",
    desc: "Workspace isolation with per-tenant policies, permissions, and data boundaries.",
  },
  {
    title: "Extensible",
    desc: "Module system with typed APIs, webhook support, and a developer-friendly extension model.",
  },
];

export default function ProductPage() {
  return (
    <div className="marketing-page">
      <div className="marketing-page-hero">
        <h1>One platform for everything</h1>
        <p>
          Email, calendar, tasks, automations, and AI copilot — unified in a
          single workspace. No more context switching.
        </p>
      </div>

      <section className="marketing-section">
        <div className="marketing-section__inner">
          <div className="marketing-section__header">
            <p className="marketing-section__label">Capabilities</p>
            <h2 className="marketing-section__title">
              Built for how you actually work
            </h2>
          </div>

          <div className="marketing-features">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="marketing-feature">
                <h3 className="marketing-feature__title">{c.title}</h3>
                <p className="marketing-feature__desc">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--alt">
        <div className="marketing-section__inner">
          <div className="marketing-section__header">
            <p className="marketing-section__label">Architecture</p>
            <h2 className="marketing-section__title">
              Designed for scale from day one
            </h2>
          </div>

          <div className="marketing-arch-grid">
            {ARCHITECTURE.map((a) => (
              <div key={a.title} className="marketing-arch-item">
                <h3 className="marketing-arch-item__title">{a.title}</h3>
                <p className="marketing-arch-item__desc">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-cta-banner">
        <div className="marketing-cta-banner__inner">
          <h2 className="marketing-cta-banner__title">
            See it in action
          </h2>
          <p className="marketing-cta-banner__desc">
            Start building your workspace in under two minutes.
          </p>
          <Link
            href="/signin"
            className="marketing-btn marketing-btn--primary marketing-btn--large"
          >
            Get Started
          </Link>
        </div>
      </section>
    </div>
  );
}
