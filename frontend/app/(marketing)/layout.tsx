import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./coming-soon.css";
import MarketingHeader from "./_components/MarketingHeader";
import MarketingFooter from "./_components/MarketingFooter";

export const metadata: Metadata = {
  title: "elyra core — calm intelligence for complex work",
  description:
    "One environment for mail, calendar, tasks, and documents — with an AI layer that understands your context. For individuals and teams.",
  openGraph: {
    title: "elyra core — calm intelligence for complex work",
    description:
      "One environment for mail, calendar, tasks, and documents — with an AI layer that understands your context.",
    siteName: "elyra core",
    type: "website",
  },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-shell">
      <MarketingHeader />
      <main className="marketing-main">{children}</main>
      <MarketingFooter />
    </div>
  );
}
