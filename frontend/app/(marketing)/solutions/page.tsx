import Link from "next/link";

const SOLUTIONS = [
  {
    title: "For Startups",
    desc: "Ship faster with an AI copilot that handles email, scheduling, and task management while you focus on building your product.",
    features: [
      "Personal and team workspaces",
      "Gmail and Calendar integration",
      "AI-assisted email triage and scheduling",
      "Task management with context awareness",
    ],
  },
  {
    title: "For Agencies",
    desc: "Manage multiple client workspaces with separate contexts, permissions, and automations from one account.",
    features: [
      "Multi-workspace management",
      "Per-client isolation and branding",
      "Automated reporting and workflows",
      "Team collaboration with role-based access",
    ],
  },
  {
    title: "For Enterprise",
    desc: "Deploy Elyra Core across your organization with SSO, audit trails, compliance controls, and custom integrations.",
    features: [
      "SSO and SAML authentication",
      "Audit trails and compliance logging",
      "Custom module development",
      "Dedicated support and SLA",
    ],
  },
];

export default function SolutionsPage() {
  return (
    <div className="marketing-page">
      <div className="marketing-page-hero">
        <h1>Built for every stage</h1>
        <p>
          From solo founders to enterprise teams, Elyra Core adapts to how you
          work and scales with your organization.
        </p>
      </div>

      <section className="marketing-section">
        <div className="marketing-section__inner">
          <div className="marketing-cards">
            {SOLUTIONS.map((s) => (
              <div key={s.title} className="marketing-card">
                <h3 className="marketing-card__name">{s.title}</h3>
                <p className="marketing-card__desc">{s.desc}</p>
                <ul className="marketing-card__features">
                  {s.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="marketing-card__cta">
                  <Link
                    href="/signin"
                    className="marketing-btn marketing-btn--secondary"
                  >
                    Get Started
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-cta-banner">
        <div className="marketing-cta-banner__inner">
          <h2 className="marketing-cta-banner__title">
            Not sure which plan fits?
          </h2>
          <p className="marketing-cta-banner__desc">
            Start free and upgrade as your team grows. No commitment required.
          </p>
          <Link
            href="/pricing"
            className="marketing-btn marketing-btn--primary marketing-btn--large"
          >
            View Pricing
          </Link>
        </div>
      </section>
    </div>
  );
}
