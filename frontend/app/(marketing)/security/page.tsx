import Link from "next/link";

const SECURITY_FEATURES = [
  {
    title: "Edge Infrastructure",
    desc: "API runs on Cloudflare Workers across 300+ global locations. No single point of failure. DDoS protection included.",
  },
  {
    title: "Data Encryption",
    desc: "All data encrypted in transit (TLS 1.3) and at rest. Session tokens are HttpOnly, Secure, SameSite cookies.",
  },
  {
    title: "Workspace Isolation",
    desc: "Each workspace operates in its own data context. Cross-workspace data access is architecturally impossible.",
  },
  {
    title: "Authentication",
    desc: "Multi-layer auth with Supabase identity, Cloudflare session management, and OAuth 2.0 for third-party integrations.",
  },
  {
    title: "Access Control",
    desc: "Role-based permissions with workspace-level policies. Admin, member, and viewer roles with granular module access.",
  },
  {
    title: "GDPR Compliance",
    desc: "Data processing in EU regions. Right to deletion, data portability, and transparent data handling policies.",
  },
];

const ARCHITECTURE = [
  {
    title: "Frontend",
    desc: "Next.js on Vercel/Cloudflare Pages. No sensitive data in client bundles. Server-side rendering for critical paths.",
  },
  {
    title: "API Layer",
    desc: "Cloudflare Workers (edge). Stateless request handling. D1 (SQLite) for structured data, KV for session state.",
  },
  {
    title: "Authentication",
    desc: "Supabase Auth for identity. Custom session management with HMAC-signed tokens. OAuth 2.0 for Google/Microsoft.",
  },
  {
    title: "AI Processing",
    desc: "LLM calls routed through secure API with intent classification. No user data used for model training.",
  },
];

export default function SecurityPage() {
  return (
    <div className="marketing-page">
      <div className="marketing-page-hero">
        <h1>Security & Architecture</h1>
        <p>
          Elyra Core is built with security-first principles. Your data stays
          yours, always.
        </p>
      </div>

      <section className="marketing-section">
        <div className="marketing-section__inner">
          <div className="marketing-section__header">
            <p className="marketing-section__label">Security</p>
            <h2 className="marketing-section__title">
              Enterprise-grade security by default
            </h2>
            <p className="marketing-section__desc">
              Every layer of the stack is designed with zero-trust principles and
              data minimization.
            </p>
          </div>

          <div className="marketing-features">
            {SECURITY_FEATURES.map((f) => (
              <div key={f.title} className="marketing-feature">
                <h3 className="marketing-feature__title">{f.title}</h3>
                <p className="marketing-feature__desc">{f.desc}</p>
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
              How it&apos;s built
            </h2>
            <p className="marketing-section__desc">
              A modern, edge-first architecture designed for reliability and
              performance at scale.
            </p>
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

      <section className="marketing-section">
        <div className="marketing-section__inner">
          <div className="marketing-section__header">
            <p className="marketing-section__label">Compliance</p>
            <h2 className="marketing-section__title">Roadmap</h2>
          </div>
          <div className="marketing-trust" style={{ justifyContent: "center", gap: "48px" }}>
            <div style={{ textAlign: "center" }}>
              <p className="marketing-stat__value" style={{ fontSize: "1.5rem" }}>GDPR</p>
              <p className="marketing-stat__label">Compliant</p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p className="marketing-stat__value" style={{ fontSize: "1.5rem" }}>SOC 2</p>
              <p className="marketing-stat__label">In Progress</p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p className="marketing-stat__value" style={{ fontSize: "1.5rem" }}>ISO 27001</p>
              <p className="marketing-stat__label">Planned</p>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-cta-banner">
        <div className="marketing-cta-banner__inner">
          <h2 className="marketing-cta-banner__title">
            Need a security review?
          </h2>
          <p className="marketing-cta-banner__desc">
            We&apos;re happy to share our security documentation and answer questions.
          </p>
          <Link
            href="/support"
            className="marketing-btn marketing-btn--secondary marketing-btn--large"
          >
            Contact Security Team
          </Link>
        </div>
      </section>
    </div>
  );
}
