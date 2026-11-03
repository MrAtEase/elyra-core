import Link from "next/link";

const PLANS = [
  {
    name: "Starter",
    price: "Free",
    period: "",
    desc: "For individuals and small teams getting started.",
    features: [
      "1 workspace",
      "Gmail and Calendar integration",
      "AI copilot (basic)",
      "Up to 3 team members",
      "Community support",
    ],
    cta: "Get Started",
    featured: false,
  },
  {
    name: "Pro",
    price: "\u20AC29",
    period: " / month",
    desc: "For growing teams that need more power and control.",
    badge: "Most Popular",
    features: [
      "Unlimited workspaces",
      "All integrations",
      "AI copilot (advanced)",
      "Up to 25 team members",
      "Priority support",
      "Custom automations",
      "Workspace branding",
    ],
    cta: "Start Free Trial",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For organizations that need security, compliance, and scale.",
    features: [
      "Everything in Pro",
      "SSO / SAML",
      "Audit trails",
      "Custom SLA",
      "Dedicated account manager",
      "Custom integrations",
      "On-premise deployment option",
    ],
    cta: "Contact Sales",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <div className="marketing-page">
      <div className="marketing-page-hero">
        <h1>Simple, transparent pricing</h1>
        <p>
          Start free. Scale when you&apos;re ready. No hidden fees, no surprises.
        </p>
      </div>

      <section className="marketing-section">
        <div className="marketing-section__inner">
          <div className="marketing-cards">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`marketing-card${plan.featured ? " marketing-card--featured" : ""}`}
              >
                {plan.badge && (
                  <span className="marketing-card__badge">{plan.badge}</span>
                )}
                <h3 className="marketing-card__name">{plan.name}</h3>
                <p className="marketing-card__price">
                  {plan.price}
                  {plan.period && <span>{plan.period}</span>}
                </p>
                <p className="marketing-card__desc">{plan.desc}</p>
                <ul className="marketing-card__features">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="marketing-card__cta">
                  <Link
                    href={plan.name === "Enterprise" ? "/support" : "/signin"}
                    className={`marketing-btn ${plan.featured ? "marketing-btn--primary" : "marketing-btn--secondary"}`}
                    style={{ width: "100%" }}
                  >
                    {plan.cta}
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
            Questions about pricing?
          </h2>
          <p className="marketing-cta-banner__desc">
            We&apos;re happy to help you find the right plan for your team.
          </p>
          <Link
            href="/support"
            className="marketing-btn marketing-btn--secondary marketing-btn--large"
          >
            Contact Us
          </Link>
        </div>
      </section>
    </div>
  );
}
